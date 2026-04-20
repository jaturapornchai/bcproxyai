import { NextRequest, NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

// Source of truth: provider_catalog. Reads:
//   • models_url      — preferred, GET returns a model list
//   • base_url        — fallback: POST a minimal chat/completion to verify
//                        the key (used when provider has no /v1/models)
//   • auth_scheme     — bearer | query-key | none | apikey-header
//   • auth_header_name — header name when scheme = apikey-header
interface CatalogRow {
  name: string;
  base_url: string;
  models_url: string | null;
  auth_scheme: string | null;
  auth_header_name: string | null;
}

export async function POST(req: NextRequest) {
  const { provider, apiKey } = await req.json();
  if (!provider || typeof provider !== "string") {
    return NextResponse.json({ ok: false, error: "Missing provider" }, { status: 400 });
  }

  const sql = getSqlClient();
  const rows = await sql<CatalogRow[]>`
    SELECT name, base_url, models_url, auth_scheme, auth_header_name
    FROM provider_catalog
    WHERE name = ${provider}
    LIMIT 1
  `;
  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: `Provider not in catalog: ${provider}` }, { status: 404 });
  }
  const cfg = rows[0];

  // Cloudflare needs account id baked into URL — allow a runtime template
  let modelsUrl = cfg.models_url ?? "";
  if (!modelsUrl && provider === "cloudflare") {
    const acct = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
    if (!acct) return NextResponse.json({ ok: false, error: "CLOUDFLARE_ACCOUNT_ID not set" });
    modelsUrl = `https://api.cloudflare.com/client/v4/accounts/${acct}/ai/models/search?task=Text+Generation`;
  }

  const scheme = (cfg.auth_scheme ?? "bearer") as "bearer" | "query-key" | "none" | "apikey-header";
  const buildHeaders = (url: string): { url: string; headers: Record<string, string> } => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    let out = url;
    if (scheme === "bearer") headers["Authorization"] = `Bearer ${apiKey}`;
    else if (scheme === "apikey-header") headers[cfg.auth_header_name ?? "apikey"] = apiKey;
    else if (scheme === "query-key") {
      const sep = out.includes("?") ? "&" : "?";
      out = `${out}${sep}key=${encodeURIComponent(apiKey)}`;
    }
    return { url: out, headers };
  };

  // Strategy 1: GET models_url (preferred — returns model count)
  if (modelsUrl) {
    try {
      const { url, headers } = buildHeaders(modelsUrl);
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const json = await res.json().catch(() => ({}));
        const models =
          (Array.isArray(json.data) ? json.data.length : 0) ||
          (Array.isArray(json.models) ? json.models.length : 0) ||
          (Array.isArray(json.result) ? json.result.length : 0) ||
          (Array.isArray(json) ? json.length : 0);
        return NextResponse.json({ ok: true, models });
      }
      if (res.status !== 405 && res.status !== 404) {
        const text = await res.text().catch(() => "");
        return NextResponse.json({ ok: false, error: `HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}` });
      }
      // 404 / 405 → provider has no /v1/models — fall through to POST chat
    } catch (err) {
      return NextResponse.json({ ok: false, error: `models probe: ${String(err).slice(0, 150)}` });
    }
  }

  // Strategy 2: POST minimal chat to base_url (for providers without /v1/models)
  const chatUrl = cfg.base_url;
  if (!chatUrl) {
    return NextResponse.json({ ok: false, error: "No endpoint configured for this provider" });
  }
  const { url: chatPostUrl, headers: chatHeaders } = buildHeaders(chatUrl);
  const body = JSON.stringify({
    // Best-effort — provider might reject model name; we only care about whether
    // auth passes. Most providers return 400 with a clear "invalid model" when
    // the key is good, which we count as "key ok + endpoint alive".
    model: provider === "chinda" ? "chinda-qwen3-4b" : "__probe__",
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 1,
  });
  try {
    const res = await fetch(chatPostUrl, { method: "POST", headers: chatHeaders, body, signal: AbortSignal.timeout(20000) });
    if (res.ok) return NextResponse.json({ ok: true, models: 1, note: "verified via chat probe" });
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ ok: false, error: `HTTP ${res.status}: invalid key` });
    }
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      return NextResponse.json({
        ok: false,
        error: `HTTP ${res.status}: upstream ${provider} กำลังล่ม (key อาจถูกต้อง — ลองใหม่ในภายหลัง)`,
      });
    }
    // 400 / 404 / 422 — endpoint reachable; body rejected. Key is almost
    // certainly valid (401 would have been returned first). Accept the save.
    const text = await res.text().catch(() => "");
    if (res.status >= 400 && res.status < 500) {
      return NextResponse.json({ ok: true, models: 1, note: `key ok (HTTP ${res.status} on probe — provider rejected dummy prompt, which is expected)` });
    }
    return NextResponse.json({ ok: false, error: `HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}` });
  } catch (err) {
    return NextResponse.json({ ok: false, error: `chat probe: ${String(err).slice(0, 150)}` });
  }
}
