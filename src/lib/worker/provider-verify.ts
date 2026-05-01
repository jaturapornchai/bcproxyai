/**
 * Provider Verify Worker
 * ──────────────────────
 * Probes each active provider's `homepage` and `models_url` and records the
 * result in provider_catalog (homepage_ok / models_ok / status codes / notes /
 * last_verified_at). Runs on the main worker cycle so dashboard always shows
 * which providers are reachable and which have gone stale.
 *
 * Intentionally simple — no hardcoded provider list. Reads every row from
 * provider_catalog and probes whatever URL it finds. New providers added by
 * auto-discovery or manual insert get verified on the next cycle automatically.
 */
import { getSqlClient } from "@/lib/db/schema";
import { getNextApiKey } from "@/lib/api-keys";
import { isProviderCostAllowed } from "@/lib/cost-policy";

const PROBE_TIMEOUT_MS = 8_000;
const CONCURRENCY = 6;
// Some providers (Cloudflare docs, Scaleway console) return 403/challenge to
// the default Node `fetch` user-agent. Use a realistic browser UA so the probe
// reflects what an actual user would see.
const PROBE_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface CatalogRow {
  name: string;
  homepage: string | null;
  models_url: string | null;
  auth_scheme: string | null;
  auth_header_name: string | null;
}

interface VerifyResult {
  name: string;
  homepage_status_code: number | null;
  homepage_ok: boolean | null;
  models_status_code: number | null;
  models_ok: boolean | null;
  public_models_count: number | null;
  notes: string;
}

// Count entries from common /v1/models response shapes
function countModels(json: unknown): number | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  if (Array.isArray(j.data)) return j.data.length;
  if (Array.isArray(j.models)) return j.models.length;
  if (Array.isArray(j.result)) return j.result.length;
  if (Array.isArray(json)) return (json as unknown[]).length;
  return null;
}

async function probeOne(row: CatalogRow): Promise<VerifyResult> {
  const notes: string[] = [];
  let hpCode: number | null = null;
  let hpOk: boolean | null = null;
  let mdCode: number | null = null;
  let mdOk: boolean | null = null;
  let publicCount: number | null = null;

  // 1. Homepage probe — any 2xx/3xx = reachable; redirects to unrelated domain
  //    are still "ok" (many providers redirect .com → dashboard).
  if (row.homepage) {
    try {
      const res = await fetch(row.homepage, {
        method: "GET",
        redirect: "follow",
        headers: { "User-Agent": PROBE_UA },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      hpCode = res.status;
      hpOk = res.status >= 200 && res.status < 400;
      if (!hpOk) notes.push(`homepage HTTP ${res.status}`);
    } catch (err) {
      hpOk = false;
      notes.push(`homepage error: ${String(err).slice(0, 80)}`);
    }
  } else {
    notes.push("no homepage set");
  }

  // 2. Models URL probe — success = 200 with parseable JSON; 401/403 also
  //    counts as "alive" (auth required but endpoint exists — good signal).
  //    Uses the provider's real stored key if available, else dummy.
  if (row.models_url) {
    if (!isProviderCostAllowed(row.name)) {
      notes.push("models probe skipped by cost policy");
      return {
        name: row.name,
        homepage_status_code: hpCode,
        homepage_ok: hpOk,
        models_status_code: null,
        models_ok: null,
        public_models_count: null,
        notes: notes.join("; "),
      };
    }

    const scheme = (row.auth_scheme ?? "bearer") as "bearer" | "query-key" | "none" | "apikey-header";
    const realKey = getNextApiKey(row.name);
    const probeKey = realKey || "dummy-for-probe";
    let url = row.models_url;
    const headers: Record<string, string> = {};
    if (scheme === "bearer") headers["Authorization"] = `Bearer ${probeKey}`;
    else if (scheme === "apikey-header") headers[row.auth_header_name ?? "apikey"] = probeKey;
    else if (scheme === "query-key") {
      const sep = url.includes("?") ? "&" : "?";
      url = `${url}${sep}key=${encodeURIComponent(probeKey)}`;
    }

    try {
      const res = await fetch(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      mdCode = res.status;
      // alive = any 2xx/3xx, or 400/401/403/429 (endpoint exists, just rejecting
      // our dummy probe). dead = 404 (gone) / 5xx (server broken).
      mdOk = (res.status >= 200 && res.status < 400) ||
             res.status === 400 || res.status === 401 || res.status === 403 || res.status === 429;
      if (!mdOk) notes.push(`models HTTP ${res.status}`);
      else if (res.status === 200) {
        // Try to count the list — works even with dummy key when the provider
        // exposes the model list publicly (pollinations, llm7, ollamacloud, …)
        try {
          const body = await res.json();
          const n = countModels(body);
          if (n !== null) {
            publicCount = n;
            notes.push(`models list OK (${n})`);
          } else {
            notes.push("models 200 but shape unknown");
          }
        } catch {
          mdOk = false;
          notes.push("models 200 but JSON invalid");
        }
      }
    } catch (err) {
      mdOk = false;
      notes.push(`models error: ${String(err).slice(0, 80)}`);
    }
  } else {
    notes.push("no models_url");
  }

  return {
    name: row.name,
    homepage_status_code: hpCode,
    homepage_ok: hpOk,
    models_status_code: mdCode,
    models_ok: mdOk,
    public_models_count: publicCount,
    notes: notes.join(" | ").slice(0, 500),
  };
}

export interface VerifyResultSummary {
  checked: number;
  homepageBroken: number;
  modelsBroken: number;
  brokenList: string[];
}

export async function verifyAllProviders(): Promise<VerifyResultSummary> {
  const sql = getSqlClient();
  const rows = await sql<CatalogRow[]>`
    SELECT name, homepage, models_url, auth_scheme, auth_header_name
    FROM provider_catalog
    WHERE status = 'active'
    ORDER BY name
  `;

  const results: VerifyResult[] = [];
  const queue = [...rows];

  async function worker() {
    while (queue.length > 0) {
      const row = queue.shift();
      if (!row) return;
      const r = await probeOne(row);
      results.push(r);
      // Write result immediately so a long-running cycle still shows progress
      try {
        await sql`
          UPDATE provider_catalog SET
            homepage_status_code = ${r.homepage_status_code},
            homepage_ok = ${r.homepage_ok},
            models_status_code = ${r.models_status_code},
            models_ok = ${r.models_ok},
            public_models_count = COALESCE(${r.public_models_count}, provider_catalog.public_models_count),
            verify_notes = ${r.notes},
            last_verified_at = now()
          WHERE name = ${r.name}
        `;
      } catch {
        /* keep going even if one row fails */
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  const homepageBroken = results.filter((r) => r.homepage_ok === false).length;
  const modelsBroken = results.filter((r) => r.models_ok === false).length;
  const brokenList = results
    .filter((r) => r.homepage_ok === false || r.models_ok === false)
    .map((r) => r.name);

  try {
    await sql`
      INSERT INTO worker_logs (step, message, level)
      VALUES ('verify', ${`🔎 ตรวจ provider ${results.length} ราย — homepage เสีย ${homepageBroken}, models เสีย ${modelsBroken}${brokenList.length > 0 ? ` (${brokenList.slice(0, 8).join(", ")}${brokenList.length > 8 ? "…" : ""})` : ""}`}, ${brokenList.length > 0 ? "warn" : "info"})
    `;
  } catch { /* ignore */ }

  return {
    checked: results.length,
    homepageBroken,
    modelsBroken,
    brokenList,
  };
}
