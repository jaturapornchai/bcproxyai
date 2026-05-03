/**
 * Self-Tuning Learning System
 * ═══════════════════════════════════════════════════════════════════
 * ระบบที่ฉลาดขึ้นเองจากการใช้งานจริง ไม่ต้องตั้งค่าเอง
 *
 * 3 Phases:
 * ─ Phase 1: Exponential cooldown + Capacity learning + Adaptive retry
 * ─ Phase 2: Category winner tracking (model ไหนเก่ง category ไหน)
 * ─ Phase 3: Auto-discover rate limits + question bank expansion
 */
import { getSqlClient } from "@/lib/db/schema";
import { ensureRedisConnected } from "@/lib/redis";

// ─── Phase 1: Fail Streak + Exponential Cooldown ──────────────────────────────

/**
 * คำนวณ cooldown duration ตาม streak
 * 1 → 10s, 2 → 20s, 3 → 40s, 4 → 80s, 5+ → 2min (cap ไม่เกิน 2 นาที)
 * เหตุผล: cooldown ยาวเกินทำให้ pool หาย → 503 cascade
 */
export function computeCooldownMs(streakCount: number): number {
  if (streakCount <= 0) return 10_000;
  if (streakCount >= 5) return 2 * 60_000;
  return 10_000 * Math.pow(2, streakCount - 1);
}

/**
 * บันทึก fail → เพิ่ม streak → คืน cooldown duration ที่ควรใช้
 * ถ้า last_fail เก่ากว่า 10 นาที → reset streak กลับเป็น 1 (ไม่ punish ต่อเนื่อง)
 */
export async function recordFailStreak(modelId: string): Promise<number> {
  try {
    const sql = getSqlClient();
    const rows = await sql<{ streak_count: number }[]>`
      INSERT INTO model_fail_streak (model_id, streak_count, last_fail_at, total_fails)
      VALUES (${modelId}, 1, now(), 1)
      ON CONFLICT (model_id) DO UPDATE SET
        streak_count = CASE
          WHEN model_fail_streak.last_fail_at < now() - interval '10 minutes' THEN 1
          ELSE model_fail_streak.streak_count + 1
        END,
        last_fail_at = now(),
        total_fails = model_fail_streak.total_fails + 1,
        updated_at = now()
      RETURNING streak_count
    `;
    const streak = rows[0]?.streak_count ?? 1;
    return computeCooldownMs(streak);
  } catch {
    return 60_000;
  }
}

/**
 * บันทึก success → reset streak
 */
export async function recordSuccessStreak(modelId: string): Promise<void> {
  try {
    const sql = getSqlClient();
    await sql`
      INSERT INTO model_fail_streak (model_id, streak_count, last_success_at, total_success)
      VALUES (${modelId}, 0, now(), 1)
      ON CONFLICT (model_id) DO UPDATE SET
        streak_count = 0,
        last_success_at = now(),
        total_success = model_fail_streak.total_success + 1,
        updated_at = now()
    `;
  } catch { /* silent */ }
}

// ─── Circuit breaker: 3-state with explicit half-open ─────────────────────────
//
// Two-tier state:
//   1) In-memory (per-pod): fail count + half-open inflight — fast, no
//      cross-pod traffic on the hot path
//   2) Redis (cross-pod): mirror of fail count + inflight slot — used so a
//      multi-pod cluster doesn't admit `pods × HALF_OPEN_PROBE_LIMIT` concurrent
//      probes against the same broken model
//
// Both layers fail-open: if Redis is unhealthy, the in-memory layer alone
// still gives single-pod protection.

const HALF_OPEN_PROBE_LIMIT = 1;
const RECENT_FAIL_TTL_MS = 30_000;
const RECENT_FAIL_TTL_SEC = Math.ceil(RECENT_FAIL_TTL_MS / 1000);
const RECENT_FAIL_THRESHOLD = 2;
// Probe slot must outlive the longest possible request (60s for the largest
// payloads — see chat/completions timeoutMs ladder). Otherwise the slot frees
// while the first probe is still in flight, letting another pod fire a parallel
// "thundering herd" probe before the first finishes.
const HALF_OPEN_PROBE_TTL_SEC = 65;

interface RecentFailState {
  count: number;
  lastFailAt: number;
}
const recentFails = new Map<string, RecentFailState>();
const halfOpenInflight = new Map<string, number>();

const CB_FAIL_PREFIX = "cb:fail:";
const CB_PROBE_PREFIX = "cb:probe:";

export type CircuitState = "closed" | "half-open";

/**
 * Tag `modelId` as having just failed. Bumps both in-memory + Redis counters.
 */
export function recordRecentFailure(modelId: string): void {
  const now = Date.now();
  const cur = recentFails.get(modelId);
  if (cur && now - cur.lastFailAt < RECENT_FAIL_TTL_MS) {
    cur.count += 1;
    cur.lastFailAt = now;
  } else {
    recentFails.set(modelId, { count: 1, lastFailAt: now });
  }
  // Mirror to Redis (best-effort, fire-and-forget)
  void mirrorFailToRedis(modelId);
}

async function mirrorFailToRedis(modelId: string): Promise<void> {
  try {
    const r = await ensureRedisConnected();
    const key = CB_FAIL_PREFIX + modelId;
    const v = await r.incr(key);
    if (v === 1) await r.expire(key, RECENT_FAIL_TTL_SEC);
  } catch { /* fail-open */ }
}

/** A success closes the breaker for this modelId across all pods. */
export function recordRecentSuccess(modelId: string): void {
  recentFails.delete(modelId);
  halfOpenInflight.delete(modelId);
  void clearBreakerInRedis(modelId);
}

async function clearBreakerInRedis(modelId: string): Promise<void> {
  try {
    const r = await ensureRedisConnected();
    await r.del(CB_FAIL_PREFIX + modelId, CB_PROBE_PREFIX + modelId);
  } catch { /* fail-open */ }
}

/**
 * Decide if a request to `modelId` should fire. Caller MUST invoke
 * `releaseCircuitProbe()` after the upstream call regardless of outcome.
 *
 * The check is intentionally synchronous against the in-memory state — Redis
 * mirroring is best-effort/eventual. This keeps the hot path zero-async.
 */
export function acquireCircuitProbe(modelId: string): { state: CircuitState; allow: boolean } {
  const cur = recentFails.get(modelId);
  const now = Date.now();
  if (cur && now - cur.lastFailAt > RECENT_FAIL_TTL_MS) {
    recentFails.delete(modelId);
  }
  const fresh = recentFails.get(modelId);
  if (!fresh || fresh.count < RECENT_FAIL_THRESHOLD) {
    return { state: "closed", allow: true };
  }
  const inflight = halfOpenInflight.get(modelId) ?? 0;
  if (inflight >= HALF_OPEN_PROBE_LIMIT) {
    return { state: "half-open", allow: false };
  }
  halfOpenInflight.set(modelId, inflight + 1);
  return { state: "half-open", allow: true };
}

/**
 * Cross-pod variant: also reserves a probe slot in Redis, so multiple pods
 * don't all admit one probe simultaneously. Falls back to local-only when
 * Redis is down.
 */
export async function acquireCircuitProbeShared(modelId: string): Promise<{ state: CircuitState; allow: boolean }> {
  const local = acquireCircuitProbe(modelId);
  if (!local.allow || local.state === "closed") return local;
  // Half-open: race in Redis to claim the global probe slot
  try {
    const r = await ensureRedisConnected();
    const key = CB_PROBE_PREFIX + modelId;
    const ok = await r.set(key, "1", "EX", HALF_OPEN_PROBE_TTL_SEC, "NX");
    if (ok !== "OK") {
      releaseCircuitProbe(modelId);
      return { state: "half-open", allow: false };
    }
  } catch {
    // Redis down — fall back to local-only; local already accepted
  }
  return local;
}

export function releaseCircuitProbe(modelId: string): void {
  const cur = halfOpenInflight.get(modelId);
  if (cur && cur > 1) halfOpenInflight.set(modelId, cur - 1);
  else halfOpenInflight.delete(modelId);
  void releaseProbeInRedis(modelId);
}

async function releaseProbeInRedis(modelId: string): Promise<void> {
  try {
    const r = await ensureRedisConnected();
    await r.del(CB_PROBE_PREFIX + modelId);
  } catch { /* fail-open */ }
}

// ─── Phase 1: Capacity Learning ───────────────────────────────────────────────

/**
 * บันทึกตัวอย่าง request + อัพเดท capacity
 * (success) → update max + p90 + avg
 * (fail + tokens) → update min_failed
 */
export async function recordSample(
  modelId: string,
  tokens: number,
  latencyMs: number,
  success: boolean,
  hasTools: boolean,
  category: string
): Promise<void> {
  try {
    const sql = getSqlClient();
    // 1. บันทึก sample ลง ring buffer
    await sql`
      INSERT INTO model_samples (model_id, tokens, latency_ms, success, has_tools, category)
      VALUES (${modelId}, ${tokens}, ${latencyMs}, ${success}, ${hasTools}, ${category})
    `;

    // 2. อัพเดท capacity summary
    if (success) {
      // คำนวณ p90 + max + avg จาก 100 sample ล่าสุด
      const stats = await sql<{ p90: number; max: number; avg: number; cnt: number }[]>`
        SELECT
          COALESCE(PERCENTILE_DISC(0.9) WITHIN GROUP (ORDER BY tokens)::int, 0) as p90,
          COALESCE(MAX(tokens), 0) as max,
          COALESCE(AVG(tokens)::int, 0) as avg,
          COUNT(*)::int as cnt
        FROM (
          SELECT tokens FROM model_samples
          WHERE model_id = ${modelId} AND success = true
          ORDER BY id DESC LIMIT 100
        ) s
      `;
      const { p90, max, avg, cnt } = stats[0] ?? { p90: 0, max: 0, avg: 0, cnt: 0 };
      const latStats = await sql<{ avg_lat: number }[]>`
        SELECT COALESCE(AVG(latency_ms)::int, 0) as avg_lat FROM (
          SELECT latency_ms FROM model_samples
          WHERE model_id = ${modelId} AND success = true
          ORDER BY id DESC LIMIT 100
        ) s
      `;
      const avgLat = latStats[0]?.avg_lat ?? 0;

      await sql`
        INSERT INTO model_capacity (
          model_id, max_successful_tokens, p90_successful_tokens,
          avg_successful_tokens, success_count, avg_latency_ms, updated_at
        )
        VALUES (${modelId}, ${max}, ${p90}, ${avg}, ${cnt}, ${avgLat}, now())
        ON CONFLICT (model_id) DO UPDATE SET
          max_successful_tokens = EXCLUDED.max_successful_tokens,
          p90_successful_tokens = EXCLUDED.p90_successful_tokens,
          avg_successful_tokens = EXCLUDED.avg_successful_tokens,
          success_count = EXCLUDED.success_count,
          avg_latency_ms = EXCLUDED.avg_latency_ms,
          updated_at = now()
      `;
    } else {
      // บันทึก min_failed_tokens (ขั้นต่ำที่ล้มเหลว)
      await sql`
        INSERT INTO model_capacity (model_id, min_failed_tokens, fail_count, updated_at)
        VALUES (${modelId}, ${tokens}, 1, now())
        ON CONFLICT (model_id) DO UPDATE SET
          min_failed_tokens = CASE
            WHEN model_capacity.min_failed_tokens IS NULL THEN ${tokens}
            WHEN model_capacity.min_failed_tokens > ${tokens} THEN ${tokens}
            ELSE model_capacity.min_failed_tokens
          END,
          fail_count = model_capacity.fail_count + 1,
          updated_at = now()
      `;
    }

    // 3. Prune samples เก่า (เก็บแค่ 500 ต่อ model)
    await sql`
      DELETE FROM model_samples
      WHERE id IN (
        SELECT id FROM model_samples
        WHERE model_id = ${modelId}
        ORDER BY id DESC OFFSET 500
      )
    `;
  } catch { /* silent */ }
}

/**
 * ตรวจว่า model นี้ไหวกับ request ขนาดนี้หรือไม่
 * ใช้ข้อมูลจาก model_samples โดยตรง (recent 20 fails) แทน permanent min_failed
 */
export async function canHandleTokens(modelId: string, tokens: number): Promise<{ ok: boolean; reason?: string }> {
  try {
    const sql = getSqlClient();
    // ดู recent failures จาก samples (20 fails ล่าสุด) — ไม่ใช่ permanent min_failed
    const recentFails = await sql<{ fail_count: number; min_fail: number | null }[]>`
      SELECT COUNT(*)::int as fail_count,
             MIN(tokens)::int as min_fail
      FROM (
        SELECT tokens FROM model_samples
        WHERE model_id = ${modelId} AND success = false
        ORDER BY id DESC LIMIT 20
      ) s
    `;
    const fails = recentFails[0];

    // ต้องเจอ fail ≥ 3 ครั้ง ภายใน 20 sample ล่าสุด ก่อนถึงจะเชื่อว่า "ขนาดนี้ fail"
    if (fails && fails.fail_count >= 3 && fails.min_fail != null && tokens >= fails.min_fail * 0.9) {
      return {
        ok: false,
        reason: `tokens ${tokens} ≥ recent min_failed ${fails.min_fail} (${fails.fail_count} recent fails)`,
      };
    }

    return { ok: true };
  } catch {
    return { ok: true };
  }
}

// ─── Regression detection ─────────────────────────────────────────────────────

const REGRESSION_DROP_THRESHOLD = 0.20; // 20-pp drop in success rate
const REGRESSION_WINDOW_HOURS = 24;
const REGRESSION_MIN_SAMPLES = 10;

/**
 * Compare success rate of last 1h vs prior 23h. If the 1h slice dropped by
 * REGRESSION_DROP_THRESHOLD or more, log a warning so operators can react.
 *
 * Cheap to run (single query). Caller invokes after each request — internal
 * cache prevents spam (one warning per modelId per 10 minutes).
 */
const lastWarnedAt = new Map<string, number>();
const WARN_COOLDOWN_MS = 10 * 60_000;

export async function checkRegressionWarning(modelId: string): Promise<{
  warned: boolean;
  recentRate?: number;
  baselineRate?: number;
  dropPp?: number;
}> {
  try {
    const lastWarn = lastWarnedAt.get(modelId) ?? 0;
    if (Date.now() - lastWarn < WARN_COOLDOWN_MS) return { warned: false };

    const sql = getSqlClient();
    const rows = await sql<{ recent_success: number; recent_total: number; baseline_success: number; baseline_total: number }[]>`
      SELECT
        COUNT(*) FILTER (WHERE success = true AND created_at >= now() - interval '1 hour')::int AS recent_success,
        COUNT(*) FILTER (WHERE created_at >= now() - interval '1 hour')::int AS recent_total,
        COUNT(*) FILTER (WHERE success = true AND created_at >= now() - interval '${sql.unsafe(String(REGRESSION_WINDOW_HOURS))} hours' AND created_at < now() - interval '1 hour')::int AS baseline_success,
        COUNT(*) FILTER (WHERE created_at >= now() - interval '${sql.unsafe(String(REGRESSION_WINDOW_HOURS))} hours' AND created_at < now() - interval '1 hour')::int AS baseline_total
      FROM model_samples
      WHERE model_id = ${modelId}
    `;
    const r = rows[0];
    if (!r || r.recent_total < REGRESSION_MIN_SAMPLES || r.baseline_total < REGRESSION_MIN_SAMPLES) {
      return { warned: false };
    }
    const recentRate = r.recent_success / r.recent_total;
    const baselineRate = r.baseline_success / r.baseline_total;
    const dropPp = baselineRate - recentRate;
    if (dropPp >= REGRESSION_DROP_THRESHOLD) {
      lastWarnedAt.set(modelId, Date.now());
      const msg = `[REGRESSION] ${modelId} — last 1h success ${(recentRate * 100).toFixed(0)}% vs baseline ${(baselineRate * 100).toFixed(0)}% (drop ${(dropPp * 100).toFixed(0)}pp, n=${r.recent_total}/${r.baseline_total})`;
      console.warn(msg);
      void postRegressionWebhook(modelId, recentRate, baselineRate, dropPp, r.recent_total, r.baseline_total);
      return { warned: true, recentRate, baselineRate, dropPp };
    }
    return { warned: false, recentRate, baselineRate, dropPp };
  } catch {
    return { warned: false };
  }
}

/**
 * POST a Slack-compatible payload to GATEWAY_REGRESSION_WEBHOOK if set.
 * Works with Slack incoming webhooks, Discord webhooks (Discord accepts the
 * `text` field as the message body), and any endpoint that takes a JSON
 * `text` payload. No-op when the env var is unset.
 */
async function postRegressionWebhook(
  modelId: string,
  recentRate: number,
  baselineRate: number,
  dropPp: number,
  recentN: number,
  baselineN: number,
): Promise<void> {
  const url = process.env.GATEWAY_REGRESSION_WEBHOOK;
  if (!url) return;
  try {
    const text = `:rotating_light: SMLGateway regression\n*model*: \`${modelId}\`\n*recent 1h*: ${(recentRate * 100).toFixed(0)}% (n=${recentN})\n*baseline 23h*: ${(baselineRate * 100).toFixed(0)}% (n=${baselineN})\n*drop*: ${(dropPp * 100).toFixed(0)}pp`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    console.warn(`[REGRESSION-WEBHOOK] post failed: ${(err as Error).message}`);
  }
}

// ─── Phase 2: Category Winner Tracking ────────────────────────────────────────

/**
 * บันทึก category outcome — ใคร win/loss
 */
export async function recordCategoryOutcome(
  category: string,
  modelId: string,
  won: boolean,
  latencyMs: number
): Promise<void> {
  try {
    const sql = getSqlClient();
    if (won) {
      await sql`
        INSERT INTO category_winners (category, model_id, wins, avg_latency_ms, win_streak, last_win_at)
        VALUES (${category}, ${modelId}, 1, ${latencyMs}, 1, now())
        ON CONFLICT (category, model_id) DO UPDATE SET
          wins = category_winners.wins + 1,
          win_streak = category_winners.win_streak + 1,
          loss_streak = 0,
          avg_latency_ms = (category_winners.avg_latency_ms * category_winners.wins + ${latencyMs}) / (category_winners.wins + 1),
          last_win_at = now()
      `;
    } else {
      await sql`
        INSERT INTO category_winners (category, model_id, losses, loss_streak, last_loss_at)
        VALUES (${category}, ${modelId}, 1, 1, now())
        ON CONFLICT (category, model_id) DO UPDATE SET
          losses = category_winners.losses + 1,
          loss_streak = category_winners.loss_streak + 1,
          win_streak = 0,
          last_loss_at = now()
      `;
    }
  } catch { /* silent */ }
}

/**
 * คืน model ids ที่เก่ง category นี้ (sorted by wins)
 */
export async function getCategoryWinners(category: string, limit = 5): Promise<string[]> {
  try {
    const sql = getSqlClient();
    const rows = await sql<{ model_id: string }[]>`
      SELECT model_id FROM category_winners
      WHERE category = ${category}
        AND wins >= 3
        AND loss_streak < 3
      ORDER BY wins::float / NULLIF(wins + losses, 0) DESC, avg_latency_ms ASC
      LIMIT ${limit}
    `;
    return rows.map(r => r.model_id);
  } catch {
    return [];
  }
}

/**
 * ตรวจว่า model มี loss_streak สูง ใน category นี้หรือไม่
 * ใช้แทน hardcoded broken-tool list — ระบบเรียนรู้จาก production
 *
 * Rules:
 *   - loss_streak >= 3 AND wins/(wins+losses) < 0.3 → unhealthy, skip
 *   - ไม่มีข้อมูล → ถือว่า OK (optimistic)
 */
export async function isModelUnhealthyForCategory(
  modelId: string,
  category: string
): Promise<{ unhealthy: boolean; reason?: string }> {
  try {
    const sql = getSqlClient();
    const rows = await sql<{ wins: number; losses: number; loss_streak: number }[]>`
      SELECT wins, losses, loss_streak
      FROM category_winners
      WHERE model_id = ${modelId} AND category = ${category}
    `;
    if (rows.length === 0) return { unhealthy: false };
    const row = rows[0];
    const total = row.wins + row.losses;
    const successRate = total > 0 ? row.wins / total : 1;
    if (row.loss_streak >= 3 && successRate < 0.3) {
      return {
        unhealthy: true,
        reason: `streak=${row.loss_streak} successRate=${(successRate * 100).toFixed(0)}%`,
      };
    }
    return { unhealthy: false };
  } catch {
    return { unhealthy: false };
  }
}

// ─── Category Detection ───────────────────────────────────────────────────────

/**
 * ตรวจจับ category จาก request body (smarter version)
 */
export function detectCategory(
  userMessage: string,
  hasTools: boolean,
  hasImages: boolean,
  estTokens: number
): string {
  if (hasTools) return "tools";
  if (hasImages) return "vision";
  if (estTokens > 20000) return "long-context";

  // Check Thai/business before medium-context — most Thai prompts are medium-size
  const msg = userMessage.slice(0, 500);
  if (/[\u0E00-\u0E7F]{3,}|งาน:|ฝ่าย|สต๊อก|ลูกค้า|SKU/.test(msg)) return "thai";

  if (estTokens > 5000) return "medium-context";
  if (/```|function\s|class\s|def\s|import\s|const\s/.test(msg)) return "code";
  if (/\d+\s*[+\-*\/=]\s*\d+|calculate|equation|คำนวณ/i.test(msg)) return "math";
  if (/translate|แปล/i.test(msg)) return "translate";
  if (/explain|what is|คืออะไร|อธิบาย/i.test(msg)) return "knowledge";
  return "general";
}

// ─── Phase 3: Adaptive Exam Schedule ──────────────────────────────────────────

/**
 * คำนวณเวลาสอบครั้งต่อไปตาม production performance
 * - live success > 95% → 7 วัน
 * - live success 70-95% → 24 ชั่วโมง
 * - live success 50-70% → 4 ชั่วโมง
 * - live success < 50% → 1 ชั่วโมง
 */
export function computeNextExamAt(liveSuccessRate: number, examFailStreak: number): Date {
  let hours: number;
  if (examFailStreak >= 3) {
    hours = 72; // สอบตก 3 ครั้งติด → พัก 3 วัน
  } else if (liveSuccessRate >= 0.95) {
    hours = 24 * 7;
  } else if (liveSuccessRate >= 0.70) {
    hours = 24;
  } else if (liveSuccessRate >= 0.50) {
    hours = 4;
  } else {
    hours = 1;
  }
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

export async function getLiveSuccessRate(modelId: string): Promise<number> {
  try {
    const sql = getSqlClient();
    const rows = await sql<{ success: number; total: number }[]>`
      SELECT
        COUNT(*) FILTER (WHERE success = true)::int as success,
        COUNT(*)::int as total
      FROM model_samples
      WHERE model_id = ${modelId}
        AND created_at >= now() - interval '24 hours'
    `;
    const row = rows[0];
    if (!row || row.total < 5) return 0.7; // not enough data → optimistic default
    return row.success / row.total;
  } catch {
    return 0.7;
  }
}

// ─── Phase 3: Auto-discover failed questions ─────────────────────────────────

export async function recordFailedPattern(userMessage: string, category: string): Promise<void> {
  if (!userMessage || userMessage.length < 10) return;
  try {
    const sql = getSqlClient();
    // Hash: ใช้ prefix 200 chars
    const prefix = userMessage.slice(0, 200);
    const hashStr = Buffer.from(prefix).toString("base64").slice(0, 32);
    await sql`
      INSERT INTO discovered_questions (question_hash, question, category)
      VALUES (${hashStr}, ${prefix}, ${category})
      ON CONFLICT (question_hash) DO UPDATE SET
        fail_count = discovered_questions.fail_count + 1,
        last_seen_at = now()
    `;
  } catch { /* silent */ }
}

// ─── Main: ทำทั้งหมดใน 1 call ─────────────────────────────────────────────────

export interface OutcomeContext {
  modelId: string;
  provider: string;
  tokens: number;
  latencyMs: number;
  success: boolean;
  hasTools: boolean;
  hasImages: boolean;
  userMessage: string;
  failReason?: string;
}

/**
 * ตรวจว่า fail นี้เป็น "quota/rate limit" ไม่ใช่ "capacity issue"
 * quota fail ไม่ควรถูกนับเป็น capacity learning — เพราะ model รับได้จริง
 */
function isQuotaFail(failReason?: string): boolean {
  if (!failReason) return false;
  return /429|rate.?limit|too_many_tokens|quota|token_quota|TPM|TPD|tokens per (minute|day)/i.test(failReason);
}

/**
 * ตรวจว่าเป็น capacity fail จริง (ไม่ไหวกับขนาดนี้)
 */
function isCapacityFail(failReason?: string): boolean {
  if (!failReason) return false;
  return /context_length|413|too large|too long|max.*token|context.*exceed/i.test(failReason);
}

/**
 * เรียกหลัง request จบ — อัพเดททุก learning table ในครั้งเดียว
 *
 * Policy:
 *   - success → record sample (success) + category win + reset streak
 *   - quota fail (429/TPM/TPD) → record category loss only (ไม่นับเป็น capacity)
 *   - capacity fail (413/context) → record sample (fail) + category loss
 *   - other fail (timeout/500) → record sample (fail) + category loss
 */
export async function recordOutcomeLearning(ctx: OutcomeContext): Promise<void> {
  const category = detectCategory(ctx.userMessage, ctx.hasTools, ctx.hasImages, ctx.tokens);
  const quotaFail = !ctx.success && isQuotaFail(ctx.failReason);

  const tasks: Promise<unknown>[] = [
    recordCategoryOutcome(category, ctx.modelId, ctx.success, ctx.latencyMs),
  ];

  // Sample บันทึกเฉพาะกรณีที่ไม่ใช่ quota fail — เพื่อไม่สับสน capacity tracking
  if (!quotaFail) {
    tasks.push(recordSample(ctx.modelId, ctx.tokens, ctx.latencyMs, ctx.success, ctx.hasTools, category));
  }

  if (ctx.success) {
    tasks.push(recordSuccessStreak(ctx.modelId));
  }

  await Promise.allSettled(tasks);

  if (!ctx.success && isCapacityFail(ctx.failReason)) {
    await recordFailedPattern(ctx.userMessage, category);
  }

  // Fire-and-forget regression check (cooldown-throttled internally)
  if (!ctx.success && !quotaFail) {
    void checkRegressionWarning(ctx.modelId);
  }
}

// ─── Dashboard helpers ────────────────────────────────────────────────────────

export async function getLearningSummary(): Promise<{
  topCategories: Array<{ category: string; topModel: string; wins: number; successRate: number }>;
  modelCapacities: Array<{ modelId: string; p90: number; max: number; minFailed: number | null; successCount: number }>;
  failStreaks: Array<{ modelId: string; streakCount: number; totalFails: number; totalSuccess: number }>;
}> {
  try {
    const sql = getSqlClient();

    const topCategories = await sql<{
      category: string; topModel: string; wins: number; successRate: number;
    }[]>`
      SELECT DISTINCT ON (category)
        category,
        model_id as "topModel",
        wins,
        (wins::float / NULLIF(wins + losses, 0))::float as "successRate"
      FROM category_winners
      WHERE wins > 0
      ORDER BY category, wins DESC
    `;

    const modelCapacities = await sql<{
      modelId: string; p90: number; max: number; minFailed: number | null; successCount: number;
    }[]>`
      SELECT model_id as "modelId",
             p90_successful_tokens as p90,
             max_successful_tokens as max,
             min_failed_tokens as "minFailed",
             success_count as "successCount"
      FROM model_capacity
      ORDER BY success_count DESC
      LIMIT 30
    `;

    const failStreaks = await sql<{
      modelId: string; streakCount: number; totalFails: number; totalSuccess: number;
    }[]>`
      SELECT model_id as "modelId",
             streak_count as "streakCount",
             total_fails as "totalFails",
             total_success as "totalSuccess"
      FROM model_fail_streak
      ORDER BY streak_count DESC, total_fails DESC
      LIMIT 30
    `;

    return { topCategories, modelCapacities, failStreaks };
  } catch {
    return { topCategories: [], modelCapacities: [], failStreaks: [] };
  }
}
