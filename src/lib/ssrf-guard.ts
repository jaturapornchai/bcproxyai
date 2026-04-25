import { lookup } from "node:dns/promises";

/**
 * Block SSRF: a parameter like base_url should never be allowed to point at
 * private network space (RFC1918), loopback, link-local, or cloud metadata
 * IPs. These are the addresses where attackers pivot to hit internal Redis,
 * Postgres, the docker daemon, or AWS/GCP metadata services.
 *
 * We resolve hostnames via DNS *before* fetch and re-check both the literal
 * IP (if the input was already an IP) and the resolved IP. DNS rebinding is
 * mitigated because the value passed to fetch() is the resolved IP, not the
 * original hostname (returned in the result, caller should use it).
 */

const PRIVATE_V4_RANGES: Array<[number, number]> = [
  // 10.0.0.0/8
  [ip4ToInt("10.0.0.0"), ip4ToInt("10.255.255.255")],
  // 172.16.0.0/12
  [ip4ToInt("172.16.0.0"), ip4ToInt("172.31.255.255")],
  // 192.168.0.0/16
  [ip4ToInt("192.168.0.0"), ip4ToInt("192.168.255.255")],
  // 127.0.0.0/8 loopback
  [ip4ToInt("127.0.0.0"), ip4ToInt("127.255.255.255")],
  // 169.254.0.0/16 link-local + cloud metadata
  [ip4ToInt("169.254.0.0"), ip4ToInt("169.254.255.255")],
  // 0.0.0.0/8
  [ip4ToInt("0.0.0.0"), ip4ToInt("0.255.255.255")],
  // 100.64.0.0/10 carrier-grade NAT
  [ip4ToInt("100.64.0.0"), ip4ToInt("100.127.255.255")],
];

function ip4ToInt(ip: string): number {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return -1;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isPrivateV4(ip: string): boolean {
  const n = ip4ToInt(ip);
  if (n < 0) return false;
  return PRIVATE_V4_RANGES.some(([lo, hi]) => n >= lo && n <= hi);
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // ::1 loopback
  if (lower === "::1") return true;
  // fc00::/7 unique local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  // fe80::/10 link-local
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
  // ::ffff:<v4-mapped>
  if (lower.startsWith("::ffff:")) {
    const v4 = lower.slice(7);
    return isPrivateV4(v4);
  }
  return false;
}

export interface SsrfCheckResult {
  ok: boolean;
  reason?: string;
  resolvedIp?: string;
}

/**
 * Validate a base URL is safe to fetch:
 *   - Scheme is http(s)
 *   - Hostname resolves to a public IP (not RFC1918/loopback/link-local)
 *   - Port is one of the typical web ports (block 22, 25, 6379, 5432, etc.)
 *
 * Returns { ok: true } only if all checks pass; returns { ok: false, reason }
 * otherwise. Caller should refuse the request when ok is false.
 *
 * Localhost / private space is allowed when SSRF_ALLOW_PRIVATE=1 (dev only).
 */
export async function checkSsrfSafe(rawUrl: string): Promise<SsrfCheckResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: `disallowed scheme: ${parsed.protocol}` };
  }

  // Block obviously dangerous ports. Empty string = default port for scheme.
  const port = parsed.port;
  if (port) {
    const portNum = Number(port);
    const ALLOWED_PORTS = new Set([80, 443, 8080, 8443, 3000, 8000]);
    if (!ALLOWED_PORTS.has(portNum)) {
      return { ok: false, reason: `disallowed port: ${port}` };
    }
  }

  const allowPrivate = process.env.SSRF_ALLOW_PRIVATE === "1";
  if (allowPrivate) {
    return { ok: true, resolvedIp: parsed.hostname };
  }

  // Resolve hostname → IP and verify the answer isn't private.
  let ip: string;
  try {
    const r = await lookup(parsed.hostname, { verbatim: true });
    ip = r.address;
  } catch {
    return { ok: false, reason: "DNS lookup failed" };
  }

  if (ip.includes(":")) {
    if (isPrivateV6(ip)) return { ok: false, reason: "resolves to private IPv6", resolvedIp: ip };
  } else {
    if (isPrivateV4(ip)) return { ok: false, reason: "resolves to private IPv4", resolvedIp: ip };
  }

  return { ok: true, resolvedIp: ip };
}
