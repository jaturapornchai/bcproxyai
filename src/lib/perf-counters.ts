/**
 * Lightweight Redis-backed perf event counters. Each event key has a 1h
 * sliding TTL — first INCR establishes a 1h window, subsequent hits within
 * the window accumulate. After expiry, next hit starts a new window.
 *
 * Non-blocking + non-critical: if Redis is unreachable, counters silently
 * return 0 so dashboard widgets degrade gracefully.
 */
import { getRedis } from "@/lib/redis";

const PERF_WINDOW_SEC = 3600;

export type PerfEvent =
  | "cache:hit"
  | "cache:miss"
  | "hedge:win"
  | "hedge:loss"
  | "spec:fire"
  | "spec:win"
  | "sticky:hit"
  | "semantic:hit"
  | "demote:rate-limit";

export function bumpPerf(event: PerfEvent): void {
  // Fire-and-forget — caller never awaits. Errors swallowed.
  void (async () => {
    try {
      const redis = getRedis();
      // Pipeline: incr + expire in one RTT (first INCR establishes window)
      await redis.pipeline().incr(`perf:${event}`).expire(`perf:${event}`, PERF_WINDOW_SEC).exec();
    } catch { /* non-critical */ }
  })();
}

export async function getPerfCounts(): Promise<Record<PerfEvent, number>> {
  const events: PerfEvent[] = [
    "cache:hit", "cache:miss",
    "hedge:win", "hedge:loss",
    "spec:fire", "spec:win",
    "sticky:hit", "semantic:hit", "demote:rate-limit",
  ];
  const zero = Object.fromEntries(events.map(e => [e, 0])) as Record<PerfEvent, number>;
  try {
    const redis = getRedis();
    const keys = events.map(e => `perf:${e}`);
    const values = await redis.mget(...keys);
    events.forEach((e, i) => { zero[e] = Number(values[i] ?? 0); });
    return zero;
  } catch {
    return zero;
  }
}
