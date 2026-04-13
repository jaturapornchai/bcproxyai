/**
 * Provider enable/disable toggle — ผู้ใช้ปิด provider ผ่าน UI ได้
 * Cache 5s เพื่อไม่ hit DB ทุก request
 */
import { getSqlClient } from "@/lib/db/schema";

let cache: Map<string, boolean> | null = null;
let cacheAt = 0;
const TTL_MS = 5_000;

async function loadCache(): Promise<Map<string, boolean>> {
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
    cache = new Map();
    cacheAt = Date.now();
    return cache;
  }
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
    // Trigger background load
    loadCache().catch(() => {});
    return true;
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
  cache = null; // invalidate
}

export async function getAllProviderToggles(): Promise<Record<string, boolean>> {
  const map = await loadCache();
  return Object.fromEntries(map);
}

export function invalidateProviderToggleCache(): void {
  cache = null;
}
