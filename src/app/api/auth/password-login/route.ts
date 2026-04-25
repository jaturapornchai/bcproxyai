import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_COOKIE_MAX_AGE,
  ADMIN_COOKIE_NAME,
  adminPasswordEnabled,
  checkAdminPassword,
  mintAdminCookie,
} from "@/lib/admin-cookie";
import { getRedis } from "@/lib/redis";

export const dynamic = "force-dynamic";

// 5 fails per IP per 15 minutes — backed by Redis so the limit holds across
// scaled replicas. Falls back to in-memory if Redis is down so a Redis blip
// doesn't lock everyone out of the admin UI.
const FAIL_WINDOW_SEC = 15 * 60;
const FAIL_LIMIT = 5;

// Number of upstream proxies we trust to set X-Forwarded-For. With Caddy in
// front we trust exactly one hop; tweak via TRUSTED_PROXY_HOPS if you stack
// more reverse proxies (e.g. Cloudflare → Caddy → Next = 2).
const TRUSTED_HOPS = (() => {
  const raw = Number(process.env.TRUSTED_PROXY_HOPS);
  if (!Number.isFinite(raw) || raw < 0) return 1;
  return Math.min(Math.floor(raw), 5);
})();

const inMemoryFails = new Map<string, { count: number; resetAt: number }>();

function rateLimitKey(req: NextRequest): string {
  // The rightmost N entries in XFF are the ones our trusted proxies appended;
  // anything to the left was put there by the original client and can be
  // forged. Pick the entry at position (len - TRUSTED_HOPS) — that's the
  // outermost address our infrastructure can vouch for.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) {
      const idx = Math.max(0, parts.length - TRUSTED_HOPS);
      return parts[idx] || "unknown";
    }
  }
  // Last resort — direct connection or no XFF set
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

async function tooManyFails(ip: string): Promise<boolean> {
  try {
    const redis = getRedis();
    const count = Number(await redis.get(`login-fails:${ip}`));
    return Number.isFinite(count) && count >= FAIL_LIMIT;
  } catch {
    // Redis down → fall back to in-memory map (single-replica behavior)
    const now = Date.now();
    const rec = inMemoryFails.get(ip);
    if (!rec || rec.resetAt < now) return false;
    return rec.count >= FAIL_LIMIT;
  }
}

async function recordFail(ip: string): Promise<void> {
  try {
    const redis = getRedis();
    const key = `login-fails:${ip}`;
    const next = await redis.incr(key);
    if (next === 1) await redis.expire(key, FAIL_WINDOW_SEC);
  } catch {
    const now = Date.now();
    const rec = inMemoryFails.get(ip);
    if (!rec || rec.resetAt < now) {
      inMemoryFails.set(ip, { count: 1, resetAt: now + FAIL_WINDOW_SEC * 1000 });
    } else {
      rec.count += 1;
    }
  }
}

async function clearFails(ip: string): Promise<void> {
  try {
    await getRedis().del(`login-fails:${ip}`);
  } catch {
    inMemoryFails.delete(ip);
  }
}

export async function POST(req: NextRequest) {
  if (!adminPasswordEnabled()) {
    return NextResponse.json({ error: "admin password not configured" }, { status: 404 });
  }

  const ip = rateLimitKey(req);
  if (await tooManyFails(ip)) {
    return NextResponse.json(
      { error: `too many failed attempts — try again later` },
      { status: 429 },
    );
  }

  let submitted = "";
  try {
    const body = await req.json();
    submitted = typeof body?.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  if (!checkAdminPassword(submitted)) {
    await recordFail(ip);
    // Artificial delay so brute-force sees consistent ~500ms regardless of
    // timing-safe's micro-variance.
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json({ error: "invalid password" }, { status: 401 });
  }

  await clearFails(ip);
  const token = mintAdminCookie();
  if (!token) {
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_COOKIE_MAX_AGE,
  });
  return res;
}
