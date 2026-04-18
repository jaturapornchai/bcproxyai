import { NextRequest, NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";
import { getAllProviderToggles } from "@/lib/provider-toggle";

export const dynamic = "force-dynamic";

// Provider list มาจาก provider_catalog (DB) — ไม่ใช้ hardcoded
// Special: provider เหล่านี้ใช้งานได้โดยไม่ต้อง API key
const NO_KEY_REQUIRED = new Set(["ollama", "pollinations"]);

interface CatalogRow {
  name: string;
  label: string | null;
  env_var: string | null;
  homepage: string | null;
  source: string;
  free_tier: boolean;
}

export async function GET(req: NextRequest) {
  try {
    const sql = getSqlClient();
    // ?source=all → ทุก provider (รวม OR/HF discovered)
    // default → เฉพาะที่มี endpoint direct (seed + manual) — Setup modal ใช้
    const includeAll = req.nextUrl.searchParams.get("source") === "all";

    // Model counts per provider
    const rows = await sql<{ provider: string; model_count: number; available_count: number }[]>`
      SELECT m.provider, COUNT(*) as model_count,
        SUM(CASE WHEN m.id NOT IN (
          SELECT h.model_id FROM health_logs h
          INNER JOIN (SELECT model_id, MAX(id) as max_id FROM health_logs GROUP BY model_id) l
            ON h.model_id = l.model_id AND h.id = l.max_id
          WHERE h.cooldown_until > now()
        ) THEN 1 ELSE 0 END) as available_count
      FROM models m
      GROUP BY m.provider
    `;
    const dbMap = new Map(rows.map(r => [r.provider, r]));

    // DB-stored API keys
    const dbKeys = new Map<string, string>();
    try {
      const keyRows = await sql<{ provider: string; api_key: string }[]>`
        SELECT provider, api_key FROM api_keys
      `;
      for (const r of keyRows) dbKeys.set(r.provider, r.api_key);
    } catch { /* table may not exist yet */ }

    // Provider list from catalog (DB)
    // Default: เฉพาะ seed + manual (มี endpoint direct จริง — ใส่ key ใน Setup ได้)
    // OR/HF/pattern discovered → ดูใน Catalog panel แยก
    const catalogRows = includeAll
      ? await sql<CatalogRow[]>`
          SELECT name, label, env_var, homepage, source, free_tier
          FROM provider_catalog
          WHERE status = 'active'
          ORDER BY source = 'seed' DESC, name
        `
      : await sql<CatalogRow[]>`
          SELECT name, label, env_var, homepage, source, free_tier
          FROM provider_catalog
          WHERE status = 'active' AND source IN ('seed', 'manual')
          ORDER BY source = 'seed' DESC, name
        `;

    const toggleMap = await getAllProviderToggles();

    const providers = catalogRows.map(c => {
      const provider = c.name;
      const noKeyRequired = NO_KEY_REQUIRED.has(provider);
      const dbKey = dbKeys.get(provider) ?? "";
      const hasDbKey = dbKey.length > 0;
      const hasKey = noKeyRequired || hasDbKey;

      const dbRow = dbMap.get(provider);
      const modelCount = Number(dbRow?.model_count ?? 0);
      const availableCount = Number(dbRow?.available_count ?? 0);

      const enabled = toggleMap[provider] ?? true;

      let status: "active" | "no_key" | "no_models" | "error" | "disabled";
      if (!enabled) status = "disabled";
      else if (!hasKey) status = "no_key";
      else if (modelCount === 0) status = "no_models";
      else if (availableCount > 0) status = "active";
      else status = "error";

      return {
        provider,
        label: c.label ?? provider,
        envVar: c.env_var ?? "",
        homepage: c.homepage ?? "",
        source: c.source,
        freeTier: c.free_tier,
        hasKey,
        hasDbKey,
        noKeyRequired,
        enabled,
        modelCount,
        availableCount,
        status,
      };
    });

    return NextResponse.json(providers);
  } catch (err) {
    console.error("[providers] error:", err);
    return NextResponse.json([], { status: 500 });
  }
}
