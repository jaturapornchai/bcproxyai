import { getSqlClient } from "@/lib/db/schema";
import { getRedis } from "@/lib/redis";
import { getNextApiKey } from "@/lib/api-keys";
import { PROVIDER_URLS } from "@/lib/providers";
import { recordOutcome } from "@/lib/live-score";

// ─── Warmup worker ───
// Pings passing models every 2min to keep upstream connections warm and
// detect dead providers fast. Uses its own Redis lock so it can run
// concurrently with the main worker cycle (separate schedule).

const WARMUP_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const WARMUP_TIMEOUT_MS = 5_000;
const MAX_MODELS_PER_WARMUP = 30;
const WARMUP_LEADER_KEY = "worker:warmup-leader";
const WARMUP_LEADER_TTL_SEC = 90;

let warmupTimer: ReturnType<typeof setInterval> | null = null;
let isWarming = false;

function workerId(): string {
  return process.env.HOSTNAME || process.env.COMPUTERNAME || "local";
}

async function acquireWarmupLeader(): Promise<boolean> {
  try {
    const redis = getRedis();
    const me = workerId();
    const result = await redis.set(WARMUP_LEADER_KEY, me, "EX", WARMUP_LEADER_TTL_SEC, "NX");
    if (result === "OK") return true;
    const holder = await redis.get(WARMUP_LEADER_KEY);
    return holder === me;
  } catch {
    // Redis down → single-replica fallback
    return true;
  }
}

async function renewWarmupLeader(): Promise<void> {
  try {
    const redis = getRedis();
    await redis.expire(WARMUP_LEADER_KEY, WARMUP_LEADER_TTL_SEC);
  } catch {
    // silent
  }
}

async function releaseWarmupLeader(): Promise<void> {
  try {
    const redis = getRedis();
    const me = workerId();
    const holder = await redis.get(WARMUP_LEADER_KEY);
    if (holder === me) {
      await redis.del(WARMUP_LEADER_KEY);
    }
  } catch {
    // silent
  }
}

async function logWorker(step: string, message: string, level = "info"): Promise<void> {
  try {
    const sql = getSqlClient();
    await sql`INSERT INTO worker_logs (step, message, level) VALUES (${step}, ${message}, ${level})`;
  } catch {
    // silent
  }
}

interface WarmupModel {
  id: string;
  provider: string;
  model_id: string;
}

async function pingModel(m: WarmupModel): Promise<{ success: boolean; latency: number }> {
  const url = PROVIDER_URLS[m.provider];
  if (!url) return { success: false, latency: 0 };

  const apiKey = getNextApiKey(m.provider);
  if (!apiKey && m.provider !== "ollama" && m.provider !== "pollinations") {
    return { success: false, latency: 0 };
  }

  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey || "dummy"}`,
      },
      body: JSON.stringify({
        model: m.model_id,
        messages: [{ role: "user", content: "." }],
        max_tokens: 1,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(WARMUP_TIMEOUT_MS),
    });
    return { success: res.ok, latency: Date.now() - start };
  } catch {
    return { success: false, latency: Date.now() - start };
  }
}

export async function runWarmupCycle(): Promise<void> {
  if (isWarming) return;

  const isLeader = await acquireWarmupLeader();
  if (!isLeader) return;

  isWarming = true;
  try {
    const sql = getSqlClient();
    // Passing models that aren't in cooldown
    const models = await sql<WarmupModel[]>`
      SELECT m.id, m.provider, m.model_id
      FROM models m
      INNER JOIN (
        SELECT DISTINCT ON (model_id) model_id, passed
        FROM exam_attempts WHERE finished_at IS NOT NULL
        ORDER BY model_id, started_at DESC
      ) ea ON m.id = ea.model_id AND ea.passed = true
      LEFT JOIN (
        SELECT DISTINCT ON (model_id) model_id, cooldown_until
        FROM health_logs ORDER BY model_id, id DESC
      ) h ON h.model_id = m.id
      WHERE h.cooldown_until IS NULL OR h.cooldown_until < now()
      LIMIT ${MAX_MODELS_PER_WARMUP}
    `;

    if (models.length === 0) {
      await logWorker("warmup", "No models to warm up");
      return;
    }

    let success = 0;
    let failed = 0;
    const CONCURRENCY = 5;
    let idx = 0;

    async function worker() {
      while (idx < models.length) {
        const m = models[idx++];
        const { success: ok, latency } = await pingModel(m);
        if (ok) {
          success++;
          recordOutcome(m.provider, m.model_id, true, latency);
        } else {
          failed++;
          recordOutcome(m.provider, m.model_id, false, latency);
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    await renewWarmupLeader();
    await logWorker("warmup", `🔥 Pinged ${models.length} models — ${success} ok, ${failed} failed`);
  } catch (err) {
    await logWorker("warmup", `Warmup cycle error: ${err}`, "error");
  } finally {
    await releaseWarmupLeader();
    isWarming = false;
  }
}

export function startWarmup(): void {
  if (warmupTimer) return;
  logWorker("warmup", "Warmup worker starting — ping every 2min");
  // Delay first run so the main gateway has time to stabilize
  setTimeout(() => {
    runWarmupCycle().catch((err) => logWorker("warmup", `Initial warmup error: ${err}`, "error"));
  }, 30_000);
  warmupTimer = setInterval(() => {
    runWarmupCycle().catch((err) => logWorker("warmup", `Scheduled warmup error: ${err}`, "error"));
  }, WARMUP_INTERVAL_MS);
}
