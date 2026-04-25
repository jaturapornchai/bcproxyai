import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { auth } from "../../../../../auth";
import { isOwnerEmail, hasOwners } from "@/lib/admin-emails";
import { ADMIN_COOKIE_NAME, adminPasswordEnabled, verifyAdminCookie } from "@/lib/admin-cookie";
import { timingSafeStringEqual } from "@/lib/secret-compare";

export const dynamic = "force-dynamic";

async function whoami(req: NextRequest): Promise<boolean> {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const master = (process.env.GATEWAY_API_KEY ?? "").trim();
  if (bearer && master && timingSafeStringEqual(bearer, master)) return true;
  if (verifyAdminCookie(req.cookies.get(ADMIN_COOKIE_NAME)?.value)) return true;
  try {
    const session = (await auth()) as { user?: { email?: string | null } } | null;
    const email = session?.user?.email ?? "";
    if (email && isOwnerEmail(email)) return true;
  } catch { /* fall through */ }
  if (!hasOwners() && !master && !adminPasswordEnabled()) return true;
  return false;
}

interface CircuitEntry {
  provider: string;
  modelId: string;
  state: "open" | "half-open";
  ttlSec: number;
  fails: number;
  succs: number;
}

async function scanKeys(pattern: string): Promise<string[]> {
  const redis = getRedis();
  const out: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
    out.push(...batch);
    cursor = next;
  } while (cursor !== "0");
  return out;
}

export async function GET(req: NextRequest) {
  if (!(await whoami(req))) {
    return NextResponse.json({ error: "owner only" }, { status: 401 });
  }
  try {
    const redis = getRedis();
    const openKeys = await scanKeys("cb:open:*");

    const entries: CircuitEntry[] = [];
    for (const key of openKeys) {
      // key = cb:open:<provider>:<modelId>  (modelId can contain colons/slashes)
      const rest = key.slice("cb:open:".length);
      const firstColon = rest.indexOf(":");
      if (firstColon < 0) continue;
      const provider = rest.slice(0, firstColon);
      const modelId = rest.slice(firstColon + 1);

      const [state, ttl, fails, succs] = await Promise.all([
        redis.get(key),
        redis.ttl(key),
        redis.get(`cb:fail:${provider}:${modelId}`).then(v => Number(v ?? 0)),
        redis.get(`cb:succ:${provider}:${modelId}`).then(v => Number(v ?? 0)),
      ]);
      if (state !== "open" && state !== "half-open") continue;
      entries.push({ provider, modelId, state, ttlSec: ttl, fails, succs });
    }

    // Also surface (provider, model) pairs with active fail streaks but circuit
    // not yet open — early-warning signal for dashboard
    const warnings: Array<{ provider: string; modelId: string; fails: number; succs: number }> = [];
    const failKeys = await scanKeys("cb:fail:*");
    for (const key of failKeys) {
      const rest = key.slice("cb:fail:".length);
      const firstColon = rest.indexOf(":");
      if (firstColon < 0) continue;
      const provider = rest.slice(0, firstColon);
      const modelId = rest.slice(firstColon + 1);
      // Skip if already in open list
      if (entries.some(e => e.provider === provider && e.modelId === modelId)) continue;
      const fails = Number((await redis.get(key)) ?? 0);
      const succs = Number((await redis.get(`cb:succ:${provider}:${modelId}`)) ?? 0);
      if (fails >= 3) warnings.push({ provider, modelId, fails, succs });
    }

    entries.sort((a, b) => (a.state === "open" ? -1 : 1) - (b.state === "open" ? -1 : 1));
    warnings.sort((a, b) => b.fails - a.fails);

    return NextResponse.json({
      open: entries.filter(e => e.state === "open"),
      halfOpen: entries.filter(e => e.state === "half-open"),
      warnings: warnings.slice(0, 20),
      summary: {
        totalOpen: entries.filter(e => e.state === "open").length,
        totalHalfOpen: entries.filter(e => e.state === "half-open").length,
        totalWarnings: warnings.length,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await whoami(req))) {
    return NextResponse.json({ error: "owner only" }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const provider = searchParams.get("provider");
    const modelId = searchParams.get("modelId");
    const redis = getRedis();

    if (provider && modelId) {
      await Promise.all([
        redis.del(`cb:open:${provider}:${modelId}`),
        redis.del(`cb:fail:${provider}:${modelId}`),
        redis.del(`cb:succ:${provider}:${modelId}`),
      ]);
      return NextResponse.json({ ok: true, cleared: `${provider}/${modelId}` });
    }

    // Reset all circuit state (nuclear option)
    const allKeys = [
      ...(await scanKeys("cb:open:*")),
      ...(await scanKeys("cb:fail:*")),
      ...(await scanKeys("cb:succ:*")),
    ];
    if (allKeys.length > 0) await redis.del(...allKeys);
    return NextResponse.json({ ok: true, clearedAll: allKeys.length });
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 500 });
  }
}
