import { NextRequest, NextResponse } from "next/server";
import { auth } from "../../../../../../../auth";
import { isOwnerEmail, hasOwners } from "@/lib/admin-emails";
import { ADMIN_COOKIE_NAME, adminPasswordEnabled, verifyAdminCookie } from "@/lib/admin-cookie";
import { timingSafeStringEqual } from "@/lib/secret-compare";
import { checkSsrfSafe } from "@/lib/ssrf-guard";
import { getNextApiKey } from "@/lib/api-keys";
import { resolveProviderUrl } from "@/lib/provider-resolver";

export const dynamic = "force-dynamic";

async function whoami(req: NextRequest): Promise<{ ok: true; label: string } | { ok: false }> {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const master = (process.env.GATEWAY_API_KEY ?? "").trim();
  if (bearer && master && timingSafeStringEqual(bearer, master)) return { ok: true, label: "master" };
  if (verifyAdminCookie(req.cookies.get(ADMIN_COOKIE_NAME)?.value)) return { ok: true, label: "password-cookie" };
  try {
    const session = (await auth()) as { user?: { email?: string | null } } | null;
    const email = session?.user?.email ?? "";
    if (email && isOwnerEmail(email)) return { ok: true, label: email };
  } catch { /* swallow */ }
  if (!hasOwners() && !master && !adminPasswordEnabled()) return { ok: true, label: "local" };
  return { ok: false };
}

interface TestBody {
  base_url?: string;  // optional override (test before save)
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const who = await whoami(req);
  if (!who.ok) return NextResponse.json({ error: "owner only" }, { status: 401 });
  const { name } = await ctx.params;
  try {
    const body = (await req.json().catch(() => ({}))) as TestBody;
    const overrideUrl = body.base_url?.trim();
    const chatUrl = overrideUrl || resolveProviderUrl(name);
    if (!chatUrl) {
      return NextResponse.json({ ok: false, error: "no URL configured" }, { status: 400 });
    }

    // Derive /v1/models URL from chat URL (works for OpenAI-compatible)
    const modelsUrl = chatUrl.replace(/\/chat\/completions$/, "/models");

    // SSRF guard — refuse if the URL resolves to private/loopback/link-local
    // space or uses a non-web port. Without this an admin (or compromised
    // session) could pivot through this endpoint to hit internal Redis,
    // Postgres, or cloud metadata at 169.254.169.254.
    const ssrf = await checkSsrfSafe(modelsUrl);
    if (!ssrf.ok) {
      return NextResponse.json(
        { ok: false, error: `URL blocked by SSRF guard: ${ssrf.reason}`, chatUrl, modelsUrl },
        { status: 400 },
      );
    }
    const apiKey = getNextApiKey(name);

    const headers: Record<string, string> = { "Accept": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const start = Date.now();
    let status = 0;
    let bodyText = "";
    let modelCount: number | null = null;
    try {
      const res = await fetch(modelsUrl, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(8_000),
      });
      status = res.status;
      bodyText = (await res.text()).slice(0, 500);
      if (res.ok) {
        try {
          const json = JSON.parse(bodyText);
          if (Array.isArray(json?.data)) modelCount = json.data.length;
          else if (Array.isArray(json?.models)) modelCount = json.models.length;
        } catch { /* not JSON */ }
      }
    } catch (err) {
      return NextResponse.json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        chatUrl,
        modelsUrl,
        latencyMs: Date.now() - start,
      });
    }

    return NextResponse.json({
      ok: status >= 200 && status < 300,
      status,
      chatUrl,
      modelsUrl,
      modelCount,
      latencyMs: Date.now() - start,
      bodyPreview: bodyText.slice(0, 200),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 500 });
  }
}
