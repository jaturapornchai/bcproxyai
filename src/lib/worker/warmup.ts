import { getSqlClient } from "@/lib/db/schema";
import { getRedis } from "@/lib/redis";
import { getNextApiKey } from "@/lib/api-keys";
import { resolveProviderUrl } from "@/lib/provider-resolver";
import { upstreamAgent } from "@/lib/upstream-agent";
import { recordOutcome } from "@/lib/live-score";

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

let warmupTimer: ReturnType<typeof setInterval> | null = null;

interface WarmupCandidate {
  id: string;
  provider: string;
  model_id: string;
}

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
    return true;
  }
}

async function pingOnce(candidate: WarmupCandidate): Promise<void> {
  const url = resolveProviderUrl(candidate.provider);
  if (!url) return;

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
  } catch {
    const latency = Date.now() - start;
    recordOutcome(candidate.provider, candidate.model_id, false, latency);
  }
}

async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i]);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
}

async function runWarmupTick(): Promise<void> {
  const isLeader = await acquireWarmupLeader();
  if (!isLeader) return;

  try {
    const sql = getSqlClient();
    // Models that passed their most-recent exam AND have no active cooldown
    // in health_logs. Mirrors the filter used by the gateway's candidate picker.
    const candidates = await sql<WarmupCandidate[]>`
      SELECT m.id, m.provider, m.model_id
      FROM models m
      WHERE EXISTS (
        SELECT 1 FROM exam_attempts e
        WHERE e.model_id = m.id
          AND e.passed = true
          AND e.started_at = (
            SELECT MAX(started_at) FROM exam_attempts WHERE model_id = m.id
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM health_logs h
        WHERE h.model_id = m.id
          AND h.cooldown_until IS NOT NULL
          AND h.cooldown_until > now()
      )
    `;

    if (candidates.length === 0) {
      console.log("[WARMUP] ไม่มี model ที่พร้อม warmup (ยังไม่ผ่านสอบหรืออยู่ cooldown)");
      return;
    }

    console.log(`[WARMUP] ping ${candidates.length} models เพื่อ keep-alive`);
    const start = Date.now();
    await runConcurrent(candidates, WARMUP_CONCURRENCY, pingOnce);
    console.log(`[WARMUP] done ${candidates.length} models in ${Date.now() - start}ms`);
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
}
