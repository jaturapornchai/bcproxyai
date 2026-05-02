/**
 * Client-side RPM throttle.
 *
 * Each provider in the hardcoded catalog ships a known per-minute request
 * ceiling (e.g. Groq 30, SEA-LION 10). Without a budget we fire requests at
 * upstream until 429 → cooldown for minutes. With a budget we skip the
 * provider locally, saving a round-trip and keeping the cooldown table
 * clean.
 *
 * Sliding window in Redis: one key per (provider, modelId), one INCR per
 * issued request, EXPIRE 60s on the first INCR. Conservative: if Redis is
 * down we allow the request (fail-open) — the provider's own limiter will
 * still protect itself.
 */
import { ensureRedisConnected } from "@/lib/redis";

const KEY_PREFIX = "rpm:";
const WINDOW_SEC = 60;

function bucketKey(provider: string, modelId: string): string {
  // Bucket by aligned minute so the counter resets cleanly without depending
  // on EXPIRE precision (which can drift under load).
  const minute = Math.floor(Date.now() / 60_000);
  return `${KEY_PREFIX}${provider}:${modelId}:${minute}`;
}

/**
 * Check whether a request can proceed within the per-minute budget.
 * Returns `{ ok: true }` when the request is allowed (and the counter has
 * been incremented). Returns `{ ok: false, retryInMs }` when the budget is
 * exhausted for the current minute window.
 *
 * `rpmLimit <= 0` or `undefined` disables the check (fail-open).
 */
export async function tryConsumeRpm(
  provider: string,
  modelId: string,
  rpmLimit?: number,
): Promise<{ ok: true } | { ok: false; retryInMs: number; usage: number; limit: number }> {
  if (!rpmLimit || rpmLimit <= 0) return { ok: true };
  try {
    const redis = await ensureRedisConnected();
    const key = bucketKey(provider, modelId);
    const usage = await redis.incr(key);
    if (usage === 1) {
      // Set TTL slightly longer than the window so a request landing on the
      // boundary still sees its own counter.
      await redis.expire(key, WINDOW_SEC + 5);
    }
    if (usage > rpmLimit) {
      const retryInMs = (60_000 - (Date.now() % 60_000)) + 50;
      return { ok: false, retryInMs, usage, limit: rpmLimit };
    }
    return { ok: true };
  } catch {
    // Fail-open: never block traffic because Redis is sick.
    return { ok: true };
  }
}

/** Read current usage without consuming — for diagnostics / dashboards. */
export async function getCurrentRpmUsage(provider: string, modelId: string): Promise<number> {
  try {
    const redis = await ensureRedisConnected();
    const v = await redis.get(bucketKey(provider, modelId));
    return v ? parseInt(v, 10) : 0;
  } catch {
    return 0;
  }
}
