import { NextRequest, NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";
import { getAllProviderToggles } from "@/lib/provider-toggle";
import { isProviderCostAllowed } from "@/lib/cost-policy";
import { getHardcodedFreeProviders } from "@/lib/free-model-catalog";

export const dynamic = "force-dynamic";

// Provider list is restricted by the hardcoded no-spend model catalog.
const NO_KEY_REQUIRED = new Set<string>();

interface CatalogRow {
  name: string;
  label: string | null;
  env_var: string | null;
  homepage: string | null;
  source: string;
  free_tier: boolean;
  notes: string | null;
  models_url: string | null;
  auth_scheme: string | null;
  homepage_ok: boolean | null;
  homepage_status_code: number | null;
  models_ok: boolean | null;
  models_status_code: number | null;
  verify_notes: string | null;
  last_verified_at: Date | null;
  public_models_count: number | null;
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
          SELECT model_id FROM latest_model_health WHERE cooldown_until > now()
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
          SELECT name, label, env_var, homepage, source, free_tier, notes,
                 models_url, auth_scheme, homepage_ok, homepage_status_code,
                 models_ok, models_status_code, verify_notes, last_verified_at,
                 public_models_count
          FROM provider_catalog
          WHERE status = 'active' AND free_tier = true
          ORDER BY source = 'seed' DESC, name
        `
      : await sql<CatalogRow[]>`
          SELECT name, label, env_var, homepage, source, free_tier, notes,
                 models_url, auth_scheme, homepage_ok, homepage_status_code,
                 models_ok, models_status_code, verify_notes, last_verified_at,
                 public_models_count
          FROM provider_catalog
          WHERE status = 'active' AND free_tier = true AND source IN ('seed', 'manual')
          ORDER BY source = 'seed' DESC, name
        `;

    for (const provider of getHardcodedFreeProviders()) {
      if (catalogRows.some((row) => row.name === provider)) continue;
      catalogRows.push({
        name: provider,
        label: provider,
        env_var: `${provider.toUpperCase()}_API_KEY`,
        homepage: provider === "openrouter" ? "https://openrouter.ai/keys" : "",
        source: "hardcoded",
        free_tier: true,
        notes: "Hardcoded free remote model catalog",
        models_url: "",
        auth_scheme: "bearer",
        homepage_ok: null,
        homepage_status_code: null,
        models_ok: null,
        models_status_code: null,
        verify_notes: null,
        last_verified_at: null,
        public_models_count: null,
      });
    }

    const toggleMap = await getAllProviderToggles();

    const safeCatalogRows = catalogRows.filter((c) => isProviderCostAllowed(c.name));
    const riskyProviders = 0;
    const providers = safeCatalogRows.map(c => {
      const provider = c.name;
      const costAllowed = isProviderCostAllowed(provider);
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
        notes: c.notes ?? "",
        modelsUrl: c.models_url ?? "",
        authScheme: c.auth_scheme ?? "bearer",
        homepageOk: c.homepage_ok,
        homepageStatusCode: c.homepage_status_code,
        modelsOk: c.models_ok,
        modelsStatusCode: c.models_status_code,
        verifyNotes: c.verify_notes ?? "",
        lastVerifiedAt: c.last_verified_at ? c.last_verified_at.toISOString() : null,
        publicModelsCount: c.public_models_count,
        costAllowed,
        costRiskLevel: costAllowed ? "safe" : "billable",
        costRiskMessage: costAllowed
          ? "อยู่ใน whitelist ฟรีของ gateway"
          : "อยู่นอก whitelist ฟรี: provider นี้อาจตัดเครดิตหรือคิดเงินเมื่อทดสอบ/ใช้งาน",
        hasKey,
        hasDbKey,
        noKeyRequired,
        enabled,
        modelCount,
        availableCount,
        status,
      };
    });

    const res = NextResponse.json(providers);
    res.headers.set("X-SMLGateway-Risky-Providers", String(riskyProviders));
    return res;
  } catch (err) {
    console.error("[providers] error:", err);
    return NextResponse.json([], { status: 500 });
  }
}
