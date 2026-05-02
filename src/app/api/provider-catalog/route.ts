import { NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

interface CatalogRow {
  name: string;
  label: string | null;
  base_url: string;
  env_var: string | null;
  homepage: string | null;
  status: string;
  source: string;
  notes: string | null;
  free_tier: boolean;
  last_probed_at: string | null;
  probe_status_code: number | null;
  discovered_at: string;
  updated_at: string;
}

export async function GET() {
  try {
    const sql = getSqlClient();
    const rows = await sql<CatalogRow[]>`
      SELECT name, label, base_url, env_var, homepage, status, source, notes, free_tier,
             last_probed_at, probe_status_code, discovered_at, updated_at
      FROM provider_catalog
      ORDER BY
        CASE status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END,
        discovered_at DESC
    `;

    const summary = {
      total: rows.length,
      active: rows.filter((r) => r.status === "active").length,
      pending: rows.filter((r) => r.status === "pending").length,
      free_tier: rows.filter((r) => r.free_tier).length,
      sources: rows.reduce<Record<string, number>>((acc, r) => {
        acc[r.source] = (acc[r.source] ?? 0) + 1;
        return acc;
      }, {}),
    };

    return NextResponse.json({ summary, providers: rows });
  } catch (err) {
    console.error("[provider-catalog] GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/provider-catalog
 * Provider discovery is disabled. The gateway uses hardcoded free models only.
 */
export async function POST() {
  return NextResponse.json(
    { ok: false, error: "Provider auto-discovery is disabled; SMLGateway uses the hardcoded free remote model catalog." },
    { status: 410 },
  );
}
