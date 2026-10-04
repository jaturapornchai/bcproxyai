/**
 * Gateway API Key service
 * ───────────────────────
 * Admin-issued Bearer tokens that clients present to call BCAiRouter's `/v1/*`
 * endpoints in production. Plaintext is shown exactly once at creation; only
 * the SHA-256 hash is persisted.
 *
 * Key format:  `bcai_live_<32 char base64url>`   (about 40 chars total)
 *
 * Verification path is a single indexed SELECT by hash. A 30-second in-memory
 * cache keeps the middleware hot path cheap when the same key hits repeatedly.
 */
import { createHash, randomBytes } from "node:crypto";
import { getSqlClient } from "@/lib/db/schema";

const KEY_PREFIX = "bcai_live_";
const PREFIX_DISPLAY_LEN = 13; // "bcai_live_Abc"
const CACHE_TTL_MS = 30_000;

function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

function generatePlaintext(): string {
  return KEY_PREFIX + randomBytes(24).toString("base64url");
}

export interface GatewayKeyRow {
  id: number;
  keyPrefix: string;
  label: string;
  createdBy: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  enabled: boolean;
  notes: string | null;
}

export interface CreatedKey extends GatewayKeyRow {
  plaintext: string; // returned ONCE at creation
}

export async function createKey(opts: {
  label: string;
  createdBy?: string;
  expiresAt?: Date | null;
  notes?: string | null;
}): Promise<CreatedKey> {
  const plaintext = generatePlaintext();
  const keyHash = hashKey(plaintext);
  const keyPrefix = plaintext.slice(0, PREFIX_DISPLAY_LEN);

  const sql = getSqlClient();
  const rows = await sql<{
    id: number;
    key_prefix: string;
    label: string;
    created_by: string | null;
    created_at: Date;
    last_used_at: Date | null;
    expires_at: Date | null;
    enabled: boolean;
    notes: string | null;
  }[]>`
    INSERT INTO gateway_api_keys (key_hash, key_prefix, label, created_by, expires_at, notes)
    VALUES (${keyHash}, ${keyPrefix}, ${opts.label}, ${opts.createdBy ?? null},
            ${opts.expiresAt ?? null}, ${opts.notes ?? null})
    RETURNING id, key_prefix, label, created_by, created_at, last_used_at, expires_at, enabled, notes
  `;
  const r = rows[0];
  return {
    id: r.id,
    keyPrefix: r.key_prefix,
    label: r.label,
    createdBy: r.created_by,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    expiresAt: r.expires_at,
    enabled: r.enabled,
    notes: r.notes,
    plaintext,
  };
}

export async function listKeys(): Promise<GatewayKeyRow[]> {
  const sql = getSqlClient();
  const rows = await sql<{
    id: number;
    key_prefix: string;
    label: string;
    created_by: string | null;
    created_at: Date;
    last_used_at: Date | null;
    expires_at: Date | null;
    enabled: boolean;
    notes: string | null;
  }[]>`
    SELECT id, key_prefix, label, created_by, created_at, last_used_at, expires_at, enabled, notes
    FROM gateway_api_keys
    ORDER BY created_at DESC
  `;
  return rows.map((r) => ({
    id: r.id,
    keyPrefix: r.key_prefix,
    label: r.label,
    createdBy: r.created_by,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    expiresAt: r.expires_at,
    enabled: r.enabled,
    notes: r.notes,
  }));
}

export async function revokeKey(id: number): Promise<void> {
  const sql = getSqlClient();
  await sql`DELETE FROM gateway_api_keys WHERE id = ${id}`;
}

export async function setEnabled(id: number, enabled: boolean): Promise<void> {
  const sql = getSqlClient();
  await sql`UPDATE gateway_api_keys SET enabled = ${enabled} WHERE id = ${id}`;
}

// ─── Verification (hot path) ─────────────────────────────────────────────────

type CacheEntry = { valid: boolean; expiresAt: number };
const verifyCache = new Map<string, CacheEntry>();

export async function verifyKey(plaintext: string): Promise<boolean> {
  if (!plaintext || !plaintext.startsWith(KEY_PREFIX)) return false;
  const hash = hashKey(plaintext);
  const now = Date.now();

  const cached = verifyCache.get(hash);
  if (cached && cached.expiresAt > now) return cached.valid;

  try {
    const sql = getSqlClient();
    const rows = await sql<{ id: number; expires_at: Date | null }[]>`
      SELECT id, expires_at FROM gateway_api_keys
      WHERE key_hash = ${hash} AND enabled = true
      LIMIT 1
    `;
    if (rows.length === 0) {
      verifyCache.set(hash, { valid: false, expiresAt: now + CACHE_TTL_MS });
      return false;
    }
    const row = rows[0];
    if (row.expires_at && row.expires_at.getTime() < now) {
      verifyCache.set(hash, { valid: false, expiresAt: now + CACHE_TTL_MS });
      return false;
    }
    // Bump last_used_at (fire-and-forget)
    sql`UPDATE gateway_api_keys SET last_used_at = now() WHERE id = ${row.id}`.catch(() => {});
    verifyCache.set(hash, { valid: true, expiresAt: now + CACHE_TTL_MS });
    return true;
  } catch {
    return false;
  }
}

export function invalidateVerifyCache(): void {
  verifyCache.clear();
}
