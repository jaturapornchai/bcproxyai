/**
 * Provider enable/disable toggle — ผู้ใช้ปิด provider ผ่าน UI ได้
 * Cache 5s เพื่อไม่ hit DB ทุก request
 */
import { getSqlClient } from "@/lib/db/schema";

let cache: Map<string, boolean> | null = null;
let cacheAt = 0;
let loading: Promise<Map<string, boolean>> | null = null;
const TTL_MS = 5_000;

function loadCache(): Promise<Map<string, boolean>> {
  loading ??= (async () => {
    try {
      const sql = getSqlClient();
      const rows = await sql<{ provider: string; enabled: boolean }[]>`
        SELECT provider, enabled FROM provider_settings
      `;
      const map = new Map<string, boolean>();
      for (const r of rows) map.set(r.provider, r.enabled);
      cache = map;
      cacheAt = Date.now();
      return map;
    } catch {
      // Keep the last known toggles (an empty map would silently re-enable every provider);
      // with nothing loaded yet the cache stays null and sync readers fail closed.
      if (cache) cacheAt = Date.now();
      return cache ?? new Map<string, boolean>();
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Await the first load so sync readers on the request path don't hit the fail-closed state. */
export async function ensureProviderTogglesLoaded(): Promise<void> {
  if (!cache) await loadCache();
}

/**
 * Default = enabled (true) ถ้า provider ไม่มี row → ใช้ได้
 */
export async function isProviderEnabled(provider: string): Promise<boolean> {
  if (!cache || Date.now() - cacheAt > TTL_MS) await loadCache();
  return cache!.get(provider) ?? true;
}

/**
 * Sync version — ใช้ค่าจาก cache เท่านั้น (สำหรับ hot path)
 * คืน true ถ้า cache ยังไม่โหลด (default optimistic)
 */
export function isProviderEnabledSync(provider: string): boolean {
  if (!cache) {
    // Fail closed: a disabled provider must never be called just because toggles aren't loaded yet.
    loadCache().catch(() => {});
    return false;
  }
  if (Date.now() - cacheAt > TTL_MS) {
    loadCache().catch(() => {});
  }
  return cache.get(provider) ?? true;
}

/**
 * Set enabled state + invalidate cache
 */
export async function setProviderEnabled(provider: string, enabled: boolean): Promise<void> {
  const sql = getSqlClient();
  await sql`
    INSERT INTO provider_settings (provider, enabled, updated_at)
    VALUES (${provider}, ${enabled}, now())
    ON CONFLICT (provider) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()
  `;
  // Reload now instead of nulling (which would fail every provider closed until it lands);
  // wait out any in-flight read first since it may predate this write.
  await loading;
  await loadCache();
}

export async function getAllProviderToggles(): Promise<Record<string, boolean>> {
  const map = await loadCache();
  return Object.fromEntries(map);
}

export function invalidateProviderToggleCache(): void {
  cache = null;
}
