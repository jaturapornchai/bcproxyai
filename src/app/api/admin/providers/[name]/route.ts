import { NextRequest, NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";
import { auth } from "../../../../../../auth";
import { isOwnerEmail, hasOwners } from "@/lib/admin-emails";
import { ADMIN_COOKIE_NAME, adminPasswordEnabled, verifyAdminCookie } from "@/lib/admin-cookie";
import { forceRefresh } from "@/lib/provider-resolver";

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

function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

interface UpdateBody {
  base_url?: string;
  status?: "active" | "paused";
  notes?: string;
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const who = await whoami(req);
  if (!who.ok) return NextResponse.json({ error: "owner only" }, { status: 401 });
  const { name } = await ctx.params;
  if (!name || !/^[a-z0-9_-]+$/i.test(name)) {
    return NextResponse.json({ error: "invalid provider name" }, { status: 400 });
  }
  try {
    const body = (await req.json()) as UpdateBody;
    const updates: { base_url?: string; status?: string; notes?: string } = {};
    if (body.base_url !== undefined) {
      const trimmed = body.base_url.trim();
      if (!isValidUrl(trimmed)) {
        return NextResponse.json({ error: "base_url must be http(s) URL" }, { status: 400 });
      }
      updates.base_url = trimmed;
    }
    if (body.status !== undefined) {
      if (body.status !== "active" && body.status !== "paused") {
        return NextResponse.json({ error: "status must be active|paused" }, { status: 400 });
      }
      updates.status = body.status;
    }
    if (body.notes !== undefined) {
      updates.notes = body.notes.slice(0, 500);
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "no fields to update" }, { status: 400 });
    }

    const sql = getSqlClient();
    const existing = await sql<{ name: string }[]>`SELECT name FROM provider_catalog WHERE name = ${name}`;
    if (existing.length === 0) {
      return NextResponse.json({ error: "provider not found" }, { status: 404 });
    }

    if (updates.base_url !== undefined && updates.status !== undefined && updates.notes !== undefined) {
      await sql`UPDATE provider_catalog SET base_url = ${updates.base_url}, status = ${updates.status}, notes = ${updates.notes}, updated_at = now() WHERE name = ${name}`;
    } else if (updates.base_url !== undefined && updates.status !== undefined) {
      await sql`UPDATE provider_catalog SET base_url = ${updates.base_url}, status = ${updates.status}, updated_at = now() WHERE name = ${name}`;
    } else if (updates.base_url !== undefined && updates.notes !== undefined) {
      await sql`UPDATE provider_catalog SET base_url = ${updates.base_url}, notes = ${updates.notes}, updated_at = now() WHERE name = ${name}`;
    } else if (updates.status !== undefined && updates.notes !== undefined) {
      await sql`UPDATE provider_catalog SET status = ${updates.status}, notes = ${updates.notes}, updated_at = now() WHERE name = ${name}`;
    } else if (updates.base_url !== undefined) {
      await sql`UPDATE provider_catalog SET base_url = ${updates.base_url}, updated_at = now() WHERE name = ${name}`;
    } else if (updates.status !== undefined) {
      await sql`UPDATE provider_catalog SET status = ${updates.status}, updated_at = now() WHERE name = ${name}`;
    } else if (updates.notes !== undefined) {
      await sql`UPDATE provider_catalog SET notes = ${updates.notes}, updated_at = now() WHERE name = ${name}`;
    }

    await forceRefresh();

    return NextResponse.json({ ok: true, name, updates, by: who.label });
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 500 });
  }
}
