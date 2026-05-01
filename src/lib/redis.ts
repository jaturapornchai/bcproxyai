import Redis from "ioredis";

let _redis: Redis | null = null;
let _connectPromise: Promise<void> | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.REDIS_URL || "redis://localhost:6379";
    _redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      // Hard ceiling on a single command. Without this, an unhealthy Redis
      // (network blip, paused container, OOM) can wedge any hot-path call
      // for tens of seconds because ioredis will keep waiting.
      commandTimeout: 1500,
      lazyConnect: true,
      // Keep the first command queued while the lazy connection opens. The
      // commandTimeout above still caps Redis impact when the service is bad.
      enableOfflineQueue: true,
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

export async function ensureRedisConnected(): Promise<Redis> {
  const r = getRedis();
  if (r.status === "ready") return r;
  if (r.status === "connect" || r.status === "connecting" || r.status === "reconnecting") {
    if (!_connectPromise) {
      _connectPromise = new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          r.off("ready", onReady);
          r.off("error", onError);
        };
        const onReady = () => { cleanup(); resolve(); };
        const onError = (err: Error) => { cleanup(); reject(err); };
        r.once("ready", onReady);
        r.once("error", onError);
      }).finally(() => { _connectPromise = null; });
    }
    await _connectPromise;
    return r;
  }

  if (!_connectPromise) {
    _connectPromise = r.connect()
      .catch((err: Error & { message?: string }) => {
        if (r.status === "ready" || /already connecting|already connected/i.test(err.message ?? "")) return;
        throw err;
      })
      .finally(() => { _connectPromise = null; });
  }
  await _connectPromise;
  return r;
}

export async function isRedisHealthy(): Promise<boolean> {
  try {
    const r = await ensureRedisConnected();
    const pong = await r.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}
