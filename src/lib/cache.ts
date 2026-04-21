interface CacheEntry<T> {
  data: T;
  expires: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

export function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry || entry.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

export function setCache<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, { data, expires: Date.now() + ttlMs });
}

// Stampede-safe cached query: if 50 requests hit a cold key at once, only one
// actually runs the loader — others await the same Promise. Prevents DB pile-up.
const inflight = new Map<string, Promise<unknown>>();

export async function cachedQuery<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = getCached<T>(key);
  if (hit !== null) return hit;
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = (async () => {
    try {
      const data = await loader();
      setCache(key, data, ttlMs);
      return data;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}

export function clearCache(prefix?: string): void {
  if (!prefix) { cache.clear(); return; }
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

// Clean expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expires < now) cache.delete(key);
  }
}, 60000);
