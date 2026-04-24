import { NextRequest, NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";
import { auth } from "../../../../../auth";
import { isOwnerEmail, hasOwners } from "@/lib/admin-emails";
import { ADMIN_COOKIE_NAME, adminPasswordEnabled, verifyAdminCookie } from "@/lib/admin-cookie";

export const dynamic = "force-dynamic";

async function whoami(req: NextRequest): Promise<{ ok: true; label: string } | { ok: false }> {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const master = (process.env.GATEWAY_API_KEY ?? "").trim();
  if (bearer && master && bearer === master) return { ok: true, label: "master" };
  if (verifyAdminCookie(req.cookies.get(ADMIN_COOKIE_NAME)?.value)) return { ok: true, label: "password-cookie" };
  try {
    const session = (await auth()) as { user?: { email?: string | null } } | null;
    const email = session?.user?.email ?? "";
    if (email && isOwnerEmail(email)) return { ok: true, label: email };
  } catch { /* swallow */ }
  if (!hasOwners() && !master && !adminPasswordEnabled()) return { ok: true, label: "local" };
  return { ok: false };
}

interface ProviderRow {
  name: string;
  label: string | null;
  base_url: string;
  env_var: string | null;
  status: string;
  source: string;
  free_tier: boolean | null;
  homepage: string | null;
  homepage_ok: boolean | null;
  models_ok: boolean | null;
  last_verified_at: string | null;
  notes: string | null;
}

export async function GET(req: NextRequest) {
  const who = await whoami(req);
  if (!who.ok) return NextResponse.json({ error: "owner only" }, { status: 401 });
  try {
    const sql = getSqlClient();
    const rows = await sql<ProviderRow[]>`
      SELECT name, label, base_url, env_var, status, source, free_tier,
             homepage, homepage_ok, models_ok, last_verified_at, notes
      FROM provider_catalog
      ORDER BY status, name
    `;
    return NextResponse.json({ providers: rows });
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 500 });
  }
}
