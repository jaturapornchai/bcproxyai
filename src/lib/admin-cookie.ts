/**
 * Admin cookie — alternative to Google OAuth for granting admin sessions.
 *
 * The cookie contains a signed `<timestamp>.<hmac>` pair so we can verify
 * it without DB / Redis lookups.
 *
 * HMAC key precedence:
 *   1. ADMIN_COOKIE_SECRET — preferred (≥32 random bytes, set per deploy)
 *   2. ADMIN_PASSWORD       — fallback (legacy: same secret as the login pw)
 *
 * Using the password as the signing key means a leaked cookie can be
 * brute-forced offline to recover the password (SHA-256 HMAC is GPU-cheap).
 * Set ADMIN_COOKIE_SECRET separately so password rotation and signing-key
 * rotation can be independent decisions.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE_NAME = "sml_admin";
const VERSION = "v1";
const MAX_AGE_S = 7 * 24 * 60 * 60; // 7 days

function signingSecret(): string | null {
  const dedicated = process.env.ADMIN_COOKIE_SECRET?.trim() ?? "";
  if (dedicated.length >= 16) return dedicated;
  const pw = process.env.ADMIN_PASSWORD?.trim() ?? "";
  return pw.length >= 4 ? pw : null;
}

function passwordSecret(): string | null {
  const pw = process.env.ADMIN_PASSWORD?.trim() ?? "";
  return pw.length >= 4 ? pw : null;
}

export function adminPasswordEnabled(): boolean {
  return passwordSecret() !== null;
}

function sign(data: string, key: string): string {
  return createHmac("sha256", key).update(data).digest("hex");
}

export function mintAdminCookie(): string | null {
  const k = signingSecret();
  if (!k) return null;
  const ts = Date.now().toString();
  const sig = sign(`${VERSION}.${ts}`, k);
  return `${VERSION}.${ts}.${sig}`;
}

export function verifyAdminCookie(value: string | undefined | null): boolean {
  const k = signingSecret();
  if (!k || !value) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [ver, tsStr, sig] = parts;
  if (ver !== VERSION) return false;
  const ts = Number(tsStr);
  if (!Number.isFinite(ts)) return false;
  if (Date.now() - ts > MAX_AGE_S * 1000) return false;
  const expected = sign(`${ver}.${tsStr}`, k);
  if (expected.length !== sig.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(sig, "hex"));
  } catch {
    return false;
  }
}

export function checkAdminPassword(submitted: string): boolean {
  const k = passwordSecret();
  if (!k || !submitted) return false;
  const a = Buffer.from(k);
  const b = Buffer.from(submitted);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const ADMIN_COOKIE_MAX_AGE = MAX_AGE_S;
