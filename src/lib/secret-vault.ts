/**
 * Secret-at-rest helper for provider API keys.
 *
 * Storage format:
 *   plaintext  — kept as-is when APP_ENCRYPTION_KEY is unset (legacy/dev)
 *   encrypted  — `enc:v1:<iv-b64>:<tag-b64>:<ct-b64>` (AES-256-GCM)
 *
 * Lazy migration — `loadSecret()` accepts both formats and returns the
 * plaintext. `seal()` always emits the encrypted form when a key is set.
 * Existing rows decrypt fine; on next save they're replaced with sealed
 * blobs. No big-bang migration needed.
 *
 * The encryption key itself is derived from APP_ENCRYPTION_KEY via SHA-256
 * so any reasonable env value (passphrase, base64 secret) works without
 * the operator having to compute the right byte length.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

function keyMaterial(): Buffer | null {
  const raw = process.env.APP_ENCRYPTION_KEY?.trim() ?? "";
  if (raw.length < 16) return null;
  // Hash the env value to a deterministic 32-byte key — accepts passphrases
  // and base64 alike without operator math.
  return createHash("sha256").update(raw).digest();
}

export function vaultEnabled(): boolean {
  return keyMaterial() !== null;
}

export function seal(plaintext: string): string {
  const key = keyMaterial();
  if (!key) return plaintext;
  if (plaintext.startsWith(PREFIX)) return plaintext; // already sealed
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function open(stored: string): string {
  if (!stored) return "";
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext row
  const key = keyMaterial();
  if (!key) {
    // Encrypted blob present but no key configured — caller can't recover.
    // Returning empty avoids accidentally leaking ciphertext through the API.
    return "";
  }
  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 3) return "";
  try {
    const iv = Buffer.from(parts[0], "base64");
    const tag = Buffer.from(parts[1], "base64");
    const ct = Buffer.from(parts[2], "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString("utf8");
  } catch {
    return "";
  }
}
