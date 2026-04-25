/**
 * Constant-time string comparison for secrets (Bearer tokens, API keys,
 * HMAC outputs, etc). Returns false if the strings differ in length so
 * timing only varies by the *length* of the input, not by which prefix
 * matched — leaking string-length is acceptable for our threat model.
 *
 * Pure JS (no node:crypto Buffer dance) so it works the same in edge,
 * Node, and test runtimes.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
