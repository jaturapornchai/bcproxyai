import { getSqlClient } from "@/lib/db/schema";
import { ensureRedisConnected } from "@/lib/redis";
import { getNextApiKey } from "@/lib/api-keys";
import { resolveProviderUrl } from "@/lib/provider-resolver";
import { upstreamAgent } from "@/lib/upstream-agent";
import { recordOutcome } from "@/lib/live-score";
import { getCostAllowedProviders, isModelCostAllowed } from "@/lib/cost-policy";

// ─── Warmup pinger ───
// Every 2 minutes, send a cheap 1-token ping to every model that has passed the
// exam and is not currently in cooldown. Keeps undici keep-alive sockets hot so
// real user traffic doesn't pay TLS handshake latency, and feeds live-score so
// candidate ordering stays fresh between full worker cycles.
//
// Uses its own Redis leader key (warmup-leader) so scaled replicas don't all
// ping at once. Falls through to "true" if Redis is unreachable.

const WARMUP_INTERVAL_MS = 2 * 60 * 1000;
const WARMUP_LEADER_KEY = "worker:warmup-leader";
const WARMUP_LEADER_TTL_SEC = 115; // slightly shorter than the 2-min interval
const WARMUP_TIMEOUT_MS = 8_000;
const WARMUP_CONCURRENCY = 8;

// Cap how many models we ping per tick. With 200+ exam-passed models the
// 2-minute fan-out can burn through small per-provider quotas. Default 30
// is enough to keep TLS keep-alive warm without flooding rate limits.
const WARMUP_MAX_MODELS = (() => {
  const raw = Number(process.env.WARMUP_MAX_MODELS);
  if (!Number.isFinite(raw) || raw <= 0) return 30;
  return Math.min(Math.max(Math.floor(raw), 1), 500);
})();

const WARMUP_MAX_PER_PROVIDER = (() => {
  const raw = Number(process.env.WARMUP_MAX_PER_PROVIDER);
  if (!Number.isFinite(raw) || raw <= 0) return 4;
  return Math.min(Math.max(Math.floor(raw), 1), 50);
})();

let warmupTimer: ReturnType<typeof setInterval> | null = null;

interface WarmupCandidate {
  id: string;
  provider: string;
  model_id: string;
}

function workerId(): string {
  return process.env.HOSTNAME || process.env.COMPUTERNAME || "local";
}

function leaderFailOpen(): boolean {
  // Same policy as src/lib/worker/leader.ts — fail-closed in production by
  // default so a Redis outage doesn't trigger every replica to ping every
  // model at once and eat upstream rate limits.
  if (process.env.WORKER_LEADER_FAIL_OPEN === "1") return true;
  return process.env.NODE_ENV !== "production";
}

async function acquireWarmupLeader(): Promise<boolean> {
  try {
    const redis = await ensureRedisConnected();
    const me = workerId();
    const result = await redis.set(WARMUP_LEADER_KEY, me, "EX", WARMUP_LEADER_TTL_SEC, "NX");
    if (result === "OK") return true;
    const holder = await redis.get(WARMUP_LEADER_KEY);
    return holder === me;
  } catch {
    return leaderFailOpen();
  }
}

async function pingOnce(candidate: WarmupCandidate): Promise<boolean> {
  if (!isModelCostAllowed(candidate.provider, candidate.model_id)) return false;

  const url = resolveProviderUrl(candidate.provider);
  if (!url) return false;

  const key = getNextApiKey(candidate.provider);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
  if (candidate.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://sml-gateway.app";
    headers["X-Title"] = "SMLGateway";
  }

  const body = JSON.stringify({
    model: candidate.model_id,
    messages: [{ role: "user", content: "." }],
    max_tokens: 1,
  });

  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(WARMUP_TIMEOUT_MS),
      // @ts-expect-error undici dispatcher not in standard fetch types
      dispatcher: upstreamAgent,
    });
    const latency = Date.now() - start;
    recordOutcome(candidate.provider, candidate.model_id, res.ok, latency);
    return res.ok;
  } catch {
    const latency = Date.now() - start;
    recordOutcome(candidate.provider, candidate.model_id, false, latency);
    return false;
  }
}

async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<boolean>
): Promise<number> {
  let idx = 0;
  let okCount = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      const ok = await fn(items[i]);
      if (ok) okCount++;
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return okCount;
}

async function runWarmupTick(): Promise<void> {
  const isLeader = await acquireWarmupLeader();
  if (!isLeader) return;

  try {
    const sql = getSqlClient();
    const costAllowedProviders = getCostAllowedProviders();
    // Models that passed their most-recent exam AND have no active cooldown.
    // Uses the latest_model_health view so latest-row logic stays in one place.
    // Ordered by recent latency (NULLs last) — fastest first, so the cap
    // preserves the ones that matter for warm sockets.
    const rows = await sql<WarmupCandidate[]>`
      WITH candidates AS (
        SELECT
          m.id,
          m.provider,
          m.model_id,
          h.latency_ms,
          ROW_NUMBER() OVER (
            PARTITION BY m.provider
            ORDER BY h.latency_ms ASC NULLS LAST, m.model_id ASC
          ) AS provider_rank
        FROM models m
        LEFT JOIN latest_model_health h ON h.model_id = m.id
        WHERE EXISTS (
          SELECT 1 FROM exam_attempts e
          WHERE e.model_id = m.id
            AND e.passed = true
            AND e.started_at = (
              SELECT MAX(started_at) FROM exam_attempts WHERE model_id = m.id
            )
        )
        AND (h.cooldown_until IS NULL OR h.cooldown_until <= now())
        AND m.provider = ANY(${costAllowedProviders})
      )
      SELECT id, provider, model_id
      FROM candidates
      WHERE provider_rank <= ${WARMUP_MAX_PER_PROVIDER}
      ORDER BY latency_ms ASC NULLS LAST, provider ASC, model_id ASC
      LIMIT ${WARMUP_MAX_MODELS}
    `;
    const candidates = rows.filter((candidate) => isModelCostAllowed(candidate.provider, candidate.model_id));

    const providerCount = candidates.reduce<Record<string, number>>((acc, c) => {
      acc[c.provider] = (acc[c.provider] ?? 0) + 1;
      return acc;
    }, {});
    const providerSummary = Object.entries(providerCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([provider, count]) => `${provider}:${count}`)
      .join(",");

    if (candidates.length === 0) {
      console.log("[WARMUP] ไม่มี model ที่พร้อม warmup (ยังไม่ผ่านสอบหรืออยู่ cooldown)");
      return;
    }

    console.log(`[WARMUP] ping ${candidates.length} models เพื่อ keep-alive (cap=${WARMUP_MAX_MODELS}, perProvider=${WARMUP_MAX_PER_PROVIDER}, providers=${providerSummary})`);
    const start = Date.now();
    const okCount = await runConcurrent(candidates, WARMUP_CONCURRENCY, pingOnce);
    const durMs = Date.now() - start;
    const failCount = candidates.length - okCount;
    const msg = `🔥 Pinged ${candidates.length} models — ${okCount} ok, ${failCount} failed (${durMs}ms)`;
    console.log(`[WARMUP] done ${candidates.length} models in ${durMs}ms`);
    try {
      await sql`INSERT INTO worker_logs (step, message, level) VALUES ('warmup', ${msg}, 'info')`;
    } catch { /* non-critical */ }
  } catch (err) {
    console.log(`[WARMUP] tick error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function startWarmup(): void {
  if (warmupTimer) return;

  console.log("[WARMUP] starting — every 2 minutes");

  // First tick fires after the interval, not at startup — the worker's initial
  // cycle already pings every model during health check, so an immediate warmup
  // would just duplicate work on a cold cache.
  warmupTimer = setInterval(() => {
    runWarmupTick().catch((err) => {
      console.log(`[WARMUP] scheduled tick error: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, WARMUP_INTERVAL_MS);
  if (typeof warmupTimer.unref === "function") warmupTimer.unref();
}

export function stopWarmup(): void {
  if (warmupTimer) {
    clearInterval(warmupTimer);
    warmupTimer = null;
  }
}
