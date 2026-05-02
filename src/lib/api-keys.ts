/**
 * API Key Rotation — round-robin + cooldown on 429
 *
 * **Source of truth: api_keys table in DB only.**
 * (.env.local API key entries are ignored — set keys via Setup modal in dashboard.)
 *
 * No no-key upstream providers are enabled in no-spend mode. Local/Ollama is
 * deliberately blocked; OpenRouter hardcoded free models still require an
 * OpenRouter key from the Setup modal.
 */
import { getSqlClient } from "@/lib/db/schema";
import { getAllProviderNames } from "@/lib/provider-resolver";
import { open as openSealed } from "@/lib/secret-vault";
import { isProviderCostAllowed } from "@/lib/cost-policy";

const NO_KEY_REQUIRED = new Set<string>();

const keyIndexMap = new Map<string, number>();
const cooldownMap = new Map<string, number>(); // "provider:key" -> cooldown until timestamp

// (paid-only providers removed: deepseek, xai, moonshot)
// Cache DB keys for 30s to avoid hitting DB on every request
let dbKeysCache: Record<string, string> = {};
let dbKeysCacheTime = 0;
let dbKeysRefreshPromise: Promise<void> | null = null;

async function refreshDbKeys(): Promise<void> {
  if (dbKeysRefreshPromise) return dbKeysRefreshPromise;

  dbKeysRefreshPromise = (async () => {
    try {
      const sql = getSqlClient();
      const rows = await sql<{ provider: string; api_key: string }[]>`
        SELECT provider, api_key FROM api_keys
      `;
      const next: Record<string, string> = {};
      for (const r of rows) {
        // openSealed is a no-op for legacy plaintext rows + decrypts the
        // enc:v1:* blobs written by /api/setup once APP_ENCRYPTION_KEY is set.
        next[r.provider] = openSealed(r.api_key);
      }
      dbKeysCache = next;
      dbKeysCacheTime = Date.now();
    } catch {
      // ignore
    } finally {
      dbKeysRefreshPromise = null;
    }
  })();

  return dbKeysRefreshPromise;
}

export async function ensureApiKeysLoaded(): Promise<void> {
  const now = Date.now();
  if (dbKeysCacheTime > 0 && now - dbKeysCacheTime <= 30_000) return;
  await refreshDbKeys();
}

export function invalidateApiKeyCache(): void {
  dbKeysCache = {};
  dbKeysCacheTime = 0;
}

function getDbKeySync(provider: string): string {
  const now = Date.now();
  if (now - dbKeysCacheTime > 30_000) {
    // Refresh async, return stale for now
    refreshDbKeys().catch(() => {});
  }
  return dbKeysCache[provider] ?? "";
}

// Clean expired entries every 100 calls
let callCount = 0;
function cleanExpired() {
  callCount++;
  if (callCount % 100 !== 0) return;
  const now = Date.now();
  for (const [key, until] of cooldownMap.entries()) {
    if (until < now) cooldownMap.delete(key);
  }
}

export function getNextApiKey(provider: string): string {
  cleanExpired();

  if (!isProviderCostAllowed(provider)) return "";

  const raw = getDbKeySync(provider);
  const keys = raw.split(",").map((k) => k.trim()).filter(Boolean);

  if (keys.length === 0 && NO_KEY_REQUIRED.has(provider)) return provider;
  if (keys.length === 0) return "";

  // Filter out cooled-down keys
  const now = Date.now();
  const available = keys.filter((k) => {
    const cd = cooldownMap.get(`${provider}:${k}`);
    return !cd || cd < now;
  });

  // Fallback to all keys if every key is in cooldown
  const pool = available.length > 0 ? available : keys;
  const idx = (keyIndexMap.get(provider) ?? 0) % pool.length;
  keyIndexMap.set(provider, idx + 1);

  return pool[idx];
}

export function markKeyCooldown(provider: string, key: string, durationMs = 300000) {
  cooldownMap.set(`${provider}:${key}`, Date.now() + durationMs);
}

/**
 * ตรวจสอบว่า provider มี API key พร้อมใช้งานหรือไม่
 * (DB only — ไม่อ่าน process.env)
 */
export function hasProviderKey(provider: string): boolean {
  if (!isProviderCostAllowed(provider)) return false;
  if (NO_KEY_REQUIRED.has(provider)) return true;
  return getNextApiKey(provider).length > 0;
}

/**
 * คืนรายชื่อ provider ที่มี key ใช้งานได้ (DB-driven)
 */
export function getAvailableProviders(): string[] {
  return getAllProviderNames().filter(hasProviderKey);
}

/**
 * Get all keys for a provider as a record (for health/benchmark that read at module level).
 * Returns the first available key per provider.
 */
export function getApiKeysRecord(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const provider of getAllProviderNames()) {
    result[provider] = getNextApiKey(provider);
  }
  return result;
}
