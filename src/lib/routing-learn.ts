import { getSqlClient } from "@/lib/db/schema";
import { cachedQuery } from "@/lib/cache";

/**
 * Prompt categories for smart routing
 * Detects what kind of prompt the user sent
 */
const CATEGORY_PATTERNS: [string, RegExp[]][] = [
  // thai checked first — strong signal; also catches business/ERP prompts in Thai
  ["thai", [/[\u0E00-\u0E7F]{3,}/, /งาน:/, /ฝ่าย/, /สต๊อก/, /ลูกค้า/, /จัดซื้อ/, /SKU/, /ต้นทุน/, /ใบเสนอ/, /พ่วงขาย/, /แจ้งเตือน/, /ต่อรอง/, /สินค้า/]],
  ["code", [/```/, /function\s/, /class\s/, /import\s/, /def\s/, /console\.log/, /return\s/, /เขียนโค้ด/i, /write.*code/i]],
  ["math", [/\d+\s*[\+\-\*\/\=]\s*\d+/, /equation/, /calculate/, /formula/i, /คำนวณ/, /สมการ/]],
  ["creative", [/write\s+a\s+(story|poem|song)/i, /creative/i, /imagine/i, /fiction/i, /แต่ง/, /กลอน/, /นิทาน/]],
  ["instruction", [/json/i, /format/i, /ตอบเป็น/, /ตามรูปแบบ/]],
  ["knowledge", [/อธิบาย/, /explain/i, /what\s+is/i, /คืออะไร/]],
  ["vision", [/ดูรูป/, /ภาพนี้/, /รูปนี้/, /image/i, /picture/i, /photo/i]],
  ["analysis", [/analyze/i, /compare/i, /evaluate/i, /pros\s+and\s+cons/i, /summarize/i, /summary/i, /วิเคราะห์/, /เปรียบเทียบ/]],
  ["translate", [/translate/i, /แปล/]],
];

export function detectPromptCategory(userMessage: string): string {
  if (!userMessage) return "general";
  for (const [cat, patterns] of CATEGORY_PATTERNS) {
    for (const p of patterns) {
      if (p.test(userMessage)) return cat;
    }
  }
  return "general";
}

/**
 * Record a routing result for learning
 */
export async function recordRoutingResult(
  modelId: string,
  provider: string,
  promptCategory: string,
  success: boolean,
  latencyMs: number
): Promise<void> {
  try {
    const sql = getSqlClient();
    // Insert the raw event row
    await sql`
      INSERT INTO routing_stats (model_id, provider, prompt_category, success, latency_ms)
      VALUES (${modelId}, ${provider}, ${promptCategory}, ${success ? 1 : 0}, ${latencyMs})
    `;
  } catch { /* non-critical */ }
}

/**
 * Get real production avg latency for a model from routing_stats (last 24h, min 3 samples)
 * Returns null if not enough data.
 */
export async function getRealAvgLatency(modelId: string): Promise<number | null> {
  try {
    const sql = getSqlClient();
    const rows = await sql<{ avg_lat: number | null; cnt: number }[]>`
      SELECT AVG(latency_ms)::float AS avg_lat, COUNT(*)::int AS cnt
      FROM routing_stats
      WHERE model_id = ${modelId}
        AND created_at >= now() - interval '24 hours'
    `;
    const row = rows[0];
    if (!row || row.cnt < 3 || row.avg_lat == null) return null;
    return row.avg_lat;
  } catch {
    return null;
  }
}

/**
 * Get best models for a given prompt category
 * Returns model IDs sorted by success rate * inverse latency
 *
 * Cached 5s in-memory — N concurrent requests in same window share the result
 * instead of hammering the 7-day aggregate query. Stampede-safe (single flight).
 */
export async function getBestModelsForCategory(promptCategory: string): Promise<string[]> {
  return cachedQuery(`best-models:${promptCategory}`, 5_000, async () => {
    try {
      const sql = getSqlClient();
      const rows = await sql<{ model_id: string }[]>`
        SELECT model_id,
          COUNT(*) as total,
          SUM(success) as successes,
          AVG(latency_ms) as avg_lat,
          CAST(SUM(success) AS REAL) / COUNT(*) as success_rate
        FROM routing_stats
        WHERE prompt_category = ${promptCategory}
          AND created_at >= now() - interval '7 days'
        GROUP BY model_id
        HAVING COUNT(*) >= 3
        ORDER BY success_rate DESC, avg_lat ASC
        LIMIT 10
      `;
      return rows.map(r => r.model_id);
    } catch {
      return [];
    }
  });
}

/**
 * Get models ranked by benchmark score for a specific category
 * Used to prioritize models that are strong in the requested area
 */
export async function getBestModelsByBenchmarkCategory(category: string): Promise<string[]> {
  return cachedQuery(`benchmark-models:${category}`, 5_000, async () => {
    try {
      const sql = getSqlClient();
      // Windowed AVG: only look at the 20 most recent evaluations per model so
      // a burst of post-gen Thai penalties can demote the model within a few
      // requests, instead of being drowned by historical high scores.
      const rows = await sql<{ model_id: string }[]>`
        SELECT model_id, AVG(score) AS avg_score, COUNT(*) AS q_count
        FROM (
          SELECT model_id, score,
            ROW_NUMBER() OVER (PARTITION BY model_id ORDER BY tested_at DESC) AS rn
          FROM benchmark_results
          WHERE category = ${category}
        ) t
        WHERE rn <= 20
        GROUP BY model_id
        HAVING COUNT(*) >= 1 AND AVG(score) >= 5
        ORDER BY AVG(score) DESC, COUNT(*) DESC
        LIMIT 20
      `;
      return rows.map(r => r.model_id);
    } catch {
      return [];
    }
  });
}

/**
 * Post-generation Thai quality check.
 *
 * Scoring:
 *   - User prompt must contain ≥ 3 Thai codepoints (otherwise the category
 *     classifier was wrong and we shouldn't judge).
 *   - Adaptive reply threshold: short prompts like "พิมพ์คำว่า สวัสดี"
 *     deserve short replies, so we require min(10, max(3, userThai/2)) Thai
 *     codepoints back rather than a fixed 10.
 *   - `?` ratio > 0.25 always fails (mojibake from bad UTF-8 handling).
 *   - Very short replies (< 6 total chars) are skipped — nothing to judge.
 *
 * Persistence:
 *   - benchmark_results is a VIEW over exam_attempts + exam_answers, so we
 *     cannot INSERT into it directly. We create an exam_attempts row
 *     (attempt_number=99 = auto-penalty marker, exam_level=null) plus one
 *     exam_answers row with question_id prefixed "thai-autopenalty-" so the
 *     retention sweep can identify and prune them.
 *   - 60-second per-model dedup prevents a flood of identical penalties from
 *     one bad model's burst.
 *   - Retention sweep runs lazily (1% sample per call) to delete rows > 7d.
 */
const THAI_FAIL_FIXED_MIN_CHARS = 10;
const THAI_FAIL_QMARK_RATIO = 0.25;
const THAI_FAIL_MIN_REPLY_LEN = 6;
const DEDUP_WINDOW_MS = 60_000;
const PENALTY_RETENTION_DAYS = 7;

const lastPenaltyAt = new Map<string, number>();

function adaptiveReplyMinChars(userThai: number): number {
  return Math.min(THAI_FAIL_FIXED_MIN_CHARS, Math.max(3, Math.floor(userThai / 2)));
}

async function cleanupOldPenalties(): Promise<void> {
  if (Math.random() > 0.01) return; // 1% sample — cheap amortised cleanup
  try {
    const sql = getSqlClient();
    await sql`
      DELETE FROM exam_answers
      WHERE question_id LIKE 'thai-autopenalty-%'
        AND id IN (
          SELECT ea.id FROM exam_answers ea
          JOIN exam_attempts a ON a.id = ea.attempt_id
          WHERE a.started_at < now() - (${PENALTY_RETENTION_DAYS}::int || ' days')::interval
        )
    `;
    await sql`
      DELETE FROM exam_attempts
      WHERE attempt_number = 99
        AND started_at < now() - (${PENALTY_RETENTION_DAYS}::int || ' days')::interval
    `;
  } catch { /* non-critical */ }
}

export async function recordThaiQualityPenalty(
  modelId: string,
  provider: string,
  userContent: string,
  responseContent: string,
): Promise<boolean> {
  if (!responseContent || responseContent.length < THAI_FAIL_MIN_REPLY_LEN) return false;

  let userThai = 0;
  for (const c of userContent) {
    const cp = c.codePointAt(0)!;
    if (cp >= 0x0e00 && cp <= 0x0e7f) userThai++;
  }
  if (userThai < 3) return false;

  let replyThai = 0;
  let qMarks = 0;
  for (const c of responseContent) {
    const cp = c.codePointAt(0)!;
    if (cp >= 0x0e00 && cp <= 0x0e7f) replyThai++;
    if (c === '?') qMarks++;
  }
  const qRatio = qMarks / responseContent.length;
  const minReplyThai = adaptiveReplyMinChars(userThai);
  const failed = replyThai < minReplyThai || qRatio > THAI_FAIL_QMARK_RATIO;
  if (!failed) return false;

  const now = Date.now();
  const last = lastPenaltyAt.get(modelId) ?? 0;
  if (now - last < DEDUP_WINDOW_MS) return false;
  lastPenaltyAt.set(modelId, now);

  try {
    const sql = getSqlClient();
    // The view benchmark_results is derived from exam_attempts ⨝ exam_answers,
    // so we insert one attempt + one answer per penalty event. The row shows
    // up as score=0 (view maps passed=false → score 0) under category='thai'.
    const qid = `thai-autopenalty-${now}`;
    await sql`
      WITH a AS (
        INSERT INTO exam_attempts (
          model_id, attempt_number, started_at, finished_at,
          total_questions, passed_questions, score_pct, passed,
          total_latency_ms
        )
        VALUES (
          ${modelId}, 99, now(), now(),
          1, 0, 0, false,
          0
        )
        RETURNING id
      )
      INSERT INTO exam_answers (
        attempt_id, question_id, category, question, answer,
        passed, check_method, fail_reason
      )
      SELECT a.id, ${qid}, 'thai', 'auto-penalty', ${responseContent.slice(0, 200)},
        false, 'post-gen-thai-check',
        ${`replyThai=${replyThai} minRequired=${minReplyThai} qRatio=${qRatio.toFixed(2)}`}
      FROM a
    `;
    await emitEvent(
      'thai_quality_fail',
      `Auto-demoted ${modelId} for Thai routing`,
      `replyThai=${replyThai}/${minReplyThai}, qRatio=${qRatio.toFixed(2)}, userThai=${userThai}`,
      provider,
      modelId,
      'warn',
    );
    void cleanupOldPenalties();
  } catch {
    /* non-critical */
  }
  return true;
}

/**
 * Emit a system event (School Bell)
 */
export async function emitEvent(
  type: string,
  title: string,
  detail?: string,
  provider?: string,
  modelId?: string,
  severity: "info" | "warn" | "error" | "success" = "info"
): Promise<void> {
  try {
    const sql = getSqlClient();
    await sql`
      INSERT INTO events (type, title, detail, provider, model_id, severity)
      VALUES (${type}, ${title}, ${detail ?? null}, ${provider ?? null}, ${modelId ?? null}, ${severity})
    `;
  } catch { /* non-critical */ }
}
