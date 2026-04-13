import Redis from "ioredis";

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.REDIS_URL || "redis://localhost:6379";
    _redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    _redis.on("error", (err) => {
      // Swallow connection errors — Redis is optional
      if (process.env.NODE_ENV !== "test") {
        console.warn("[redis] connection error:", err.message);
      }
    });
  }
  return _redis;
}

export async function isRedisHealthy(): Promise<boolean> {
  try {
    const r = getRedis();
    const pong = await r.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}
