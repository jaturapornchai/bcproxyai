interface CacheEntry<T> {
  data: T;
  expires: number;
}

// Bounded LRU-ish: Map preserves insertion order, so on overflow we drop the
// oldest key. Configurable via CACHE_MAX_ENTRIES env (clamped to safe range).
const CACHE_MAX_ENTRIES = (() => {
  const raw = Number(process.env.CACHE_MAX_ENTRIES);
  if (!Number.isFinite(raw) || raw <= 0) return 2000;
  return Math.min(Math.max(Math.floor(raw), 100), 100_000);
})();

const cache = new Map<string, CacheEntry<unknown>>();

export function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry || entry.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  // Bump to most-recent by re-inserting (Map preserves order)
  cache.delete(key);
  cache.set(key, entry);
  return entry.data as T;
}

export function setCache<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, { data, expires: Date.now() + ttlMs });
  if (cache.size > CACHE_MAX_ENTRIES) {
    // Drop oldest entries until back under cap
    const overflow = cache.size - CACHE_MAX_ENTRIES;
    let dropped = 0;
    for (const k of cache.keys()) {
      cache.delete(k);
      if (++dropped >= overflow) break;
    }
  }
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
