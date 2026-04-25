import { getRedis } from "./redis";

/**
 * Sliding window rate limiter backed by Redis.
 * Falls back to allowing requests if Redis is unavailable.
 *
 * @param key    Unique key for the rate limit bucket (e.g. IP address)
 * @param limit  Max requests allowed in the window
 * @param windowSec  Window size in seconds
 * @returns { allowed: boolean, remaining: number, resetIn: number }
 */
export async function checkRateLimit(
  key: string,
  limit = 100,
  windowSec = 60
): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
  try {
    const redis = getRedis();
    const redisKey = `rl:${key}`;
    const now = Date.now();
    const windowMs = windowSec * 1000;
    const windowStart = now - windowMs;

    // Sliding window:
    //   1. Trim entries older than window
    //   2. Count what's left BEFORE adding our own request
    //   3. If under the cap, add our entry
    // Doing it in this order means `count` reflects the requests already in
    // the window (excluding the current one) and the cap test is `count < limit`,
    // which is the common-sense reading of "limit = max requests per window".
    const pipe = redis.pipeline();
    pipe.zremrangebyscore(redisKey, "-inf", windowStart);
    pipe.zcard(redisKey);
    const trimResults = await pipe.exec();
    if (!trimResults) throw new Error("pipeline failed");

    const priorCount = (trimResults[1]?.[1] as number) ?? 0;
    const allowed = priorCount < limit;

    if (allowed) {
      const writePipe = redis.pipeline();
      writePipe.zadd(redisKey, now, `${now}-${Math.random()}`);
      writePipe.pexpire(redisKey, windowMs);
      await writePipe.exec();
    }

    const remaining = Math.max(0, limit - priorCount - (allowed ? 1 : 0));
    const resetIn = windowSec;

    return { allowed, remaining, resetIn };
  } catch {
    // Redis unavailable — allow request, degrade gracefully
    return { allowed: true, remaining: limit, resetIn: windowSec };
  }
}
