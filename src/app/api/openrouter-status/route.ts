import { NextRequest, NextResponse } from "next/server";
import { auth } from "../../../../auth";
import { isOwnerEmail, hasOwners } from "@/lib/admin-emails";
import { ADMIN_COOKIE_NAME, adminPasswordEnabled, verifyAdminCookie } from "@/lib/admin-cookie";
import { timingSafeStringEqual } from "@/lib/secret-compare";
import { getOpenRouterKeyStatus } from "@/lib/openrouter-key-status";

export const dynamic = "force-dynamic";

// Defensive owner check (proxy already gates this path): master Bearer, signed admin cookie, or Google owner session.
async function isOwner(req: NextRequest): Promise<boolean> {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const master = (process.env.GATEWAY_API_KEY ?? "").trim();
  if (bearer && master && timingSafeStringEqual(bearer, master)) return true;
  if (verifyAdminCookie(req.cookies.get(ADMIN_COOKIE_NAME)?.value)) return true;
  try {
    const session = (await auth()) as { user?: { email?: string | null } } | null;
    if (isOwnerEmail(session?.user?.email)) return true;
  } catch { /* fall through to 401 */ }
  return !hasOwners() && !master && !adminPasswordEnabled(); // local mode
}

/** GET /api/openrouter-status — owner only. Key status + spend-tripwire state (see lib/openrouter-key-status). */
export async function GET(req: NextRequest) {
  if (!(await isOwner(req))) return NextResponse.json({ error: "owner only" }, { status: 401 });
  try {
    return NextResponse.json(await getOpenRouterKeyStatus(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[openrouter-status] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
