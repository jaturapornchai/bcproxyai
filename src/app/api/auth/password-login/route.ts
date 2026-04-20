import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_COOKIE_MAX_AGE,
  ADMIN_COOKIE_NAME,
  adminPasswordEnabled,
  checkAdminPassword,
  mintAdminCookie,
} from "@/lib/admin-cookie";

export const dynamic = "force-dynamic";

// Rate limit: 5 fails per IP per 15 minutes. Simple in-memory window — fine
// for a single-replica droplet; if we scale horizontally later, swap for Redis.
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const FAIL_LIMIT = 5;
const fails = new Map<string, { count: number; resetAt: number }>();

function rateLimitKey(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  const ip = xff ? xff.split(",")[0].trim() : "unknown";
  return ip;
}

function tooManyFails(ip: string): boolean {
  const now = Date.now();
  const rec = fails.get(ip);
  if (!rec || rec.resetAt < now) return false;
  return rec.count >= FAIL_LIMIT;
}

function recordFail(ip: string) {
  const now = Date.now();
  const rec = fails.get(ip);
  if (!rec || rec.resetAt < now) {
    fails.set(ip, { count: 1, resetAt: now + FAIL_WINDOW_MS });
  } else {
    rec.count += 1;
  }
}

function clearFails(ip: string) {
  fails.delete(ip);
}

export async function POST(req: NextRequest) {
  if (!adminPasswordEnabled()) {
    return NextResponse.json({ error: "admin password not configured" }, { status: 404 });
  }

  const ip = rateLimitKey(req);
  if (tooManyFails(ip)) {
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
    recordFail(ip);
    // Artificial delay so brute-force sees consistent ~500ms regardless of
    // timing-safe's micro-variance.
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json({ error: "invalid password" }, { status: 401 });
  }

  clearFails(ip);
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
