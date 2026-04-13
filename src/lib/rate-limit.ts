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

    // Remove expired entries, add current request, count
    const pipe = redis.pipeline();
    pipe.zremrangebyscore(redisKey, "-inf", windowStart);
    pipe.zadd(redisKey, now, `${now}-${Math.random()}`);
    pipe.zcard(redisKey);
    pipe.pexpire(redisKey, windowMs);

    const results = await pipe.exec();
    if (!results) throw new Error("pipeline failed");

    const count = results[2]?.[1] as number;

    const allowed = count <= limit;
    const remaining = Math.max(0, limit - count);
    const resetIn = windowSec;

    return { allowed, remaining, resetIn };
  } catch {
    // Redis unavailable — allow request, degrade gracefully
    return { allowed: true, remaining: limit, resetIn: windowSec };
  }
}
