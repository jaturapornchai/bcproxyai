import { NextRequest, NextResponse } from "next/server";
import { revokeKey, setEnabled, invalidateVerifyCache } from "@/lib/gateway-keys";
import { auth } from "../../../../../../auth";
import { isOwnerEmail, hasOwners } from "@/lib/admin-emails";
import { ADMIN_COOKIE_NAME, adminPasswordEnabled, verifyAdminCookie } from "@/lib/admin-cookie";
import { timingSafeStringEqual } from "@/lib/secret-compare";

export const dynamic = "force-dynamic";

async function isAllowed(req: NextRequest): Promise<boolean> {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const master = (process.env.GATEWAY_API_KEY ?? "").trim();
  if (bearer && master && timingSafeStringEqual(bearer, master)) return true;
  if (verifyAdminCookie(req.cookies.get(ADMIN_COOKIE_NAME)?.value)) return true;
  try {
    const session = (await auth()) as { user?: { email?: string | null } } | null;
    const email = session?.user?.email ?? "";
    if (email && isOwnerEmail(email)) return true;
  } catch { /* ignore */ }
  if (!hasOwners() && !master && !adminPasswordEnabled()) return true; // pure local mode
  return false;
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAllowed(req))) return NextResponse.json({ error: "owner only" }, { status: 401 });
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  try {
    await revokeKey(n);
    invalidateVerifyCache();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAllowed(req))) return NextResponse.json({ error: "owner only" }, { status: 401 });
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  try {
    const { enabled } = (await req.json()) as { enabled?: boolean };
    if (typeof enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be boolean" }, { status: 400 });
    }
    await setEnabled(n, enabled);
    invalidateVerifyCache();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 500 });
  }
}
