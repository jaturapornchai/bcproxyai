import { NextRequest, NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";
import { auth } from "../../../../auth";
import { isOwnerEmail, hasOwners } from "@/lib/admin-emails";
import { ADMIN_COOKIE_NAME, adminPasswordEnabled, verifyAdminCookie } from "@/lib/admin-cookie";
import { timingSafeStringEqual } from "@/lib/secret-compare";
import { getNextApiKey } from "@/lib/api-keys";
import { resolveProviderUrl } from "@/lib/provider-resolver";
import { upstreamAgent } from "@/lib/upstream-agent";

export const dynamic = "force-dynamic";

/**
 * /api/replay — owner-only request replay against multiple providers.
 *
 * Looks up a previously-served request by reqId, pulls the stored
 * user_message (already truncated to 500 chars at log time), then forwards
 * a non-streaming completion to each candidate so the operator can compare
 * latency / output. Sensitive prompts are blocked with a coarse keyword
 * filter; setting `confirm: true` in the body overrides for emergency replays.
 *
 * Body: { reqId: string, candidates: [{ provider, model }], confirm?: boolean }
 */

interface ReplayCandidate {
  provider: string;
  model: string;
}

interface ReplayBody {
  reqId?: string;
  candidates?: ReplayCandidate[];
  confirm?: boolean;
}

const SENSITIVE_PATTERNS = [
  /\bpassword\b/i,
  /\bapi[_-]?key\b/i,
  /\bsecret\b/i,
  /\btoken\b/i,
  /\bbearer\b/i,
  /credit[\s-]?card/i,
  /\bssn\b/i,
];

function looksSensitive(text: string): boolean {
  return SENSITIVE_PATTERNS.some((re) => re.test(text));
}

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

export async function POST(req: NextRequest) {
  const who = await whoami(req);
  if (!who.ok) return NextResponse.json({ error: "owner only" }, { status: 401 });

  let body: ReplayBody;
  try {
    body = (await req.json()) as ReplayBody;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const reqId = body.reqId?.trim();
  const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 5) : [];
  if (!reqId || !/^[a-z0-9]{4,20}$/i.test(reqId)) {
    return NextResponse.json({ error: "invalid reqId" }, { status: 400 });
  }
  if (candidates.length === 0) {
    return NextResponse.json({ error: "candidates required" }, { status: 400 });
  }

  const sql = getSqlClient();
  const rows = await sql<{ user_message: string | null }[]>`
    SELECT user_message FROM gateway_logs WHERE request_id = ${reqId} ORDER BY id DESC LIMIT 1
  `;
  if (rows.length === 0 || !rows[0].user_message) {
    return NextResponse.json({ error: "trace not found or has no captured prompt" }, { status: 404 });
  }
  const prompt = rows[0].user_message;

  if (!body.confirm && looksSensitive(prompt)) {
    return NextResponse.json(
      { error: "prompt looks sensitive — set confirm: true to replay anyway", blocked: true },
      { status: 409 },
    );
  }

  const results = await Promise.all(candidates.map(async (c) => {
    if (!c.provider || !c.model) return { ...c, ok: false, error: "missing provider/model" };
    const url = resolveProviderUrl(c.provider);
    if (!url) return { ...c, ok: false, error: "unknown provider" };
    const apiKey = getNextApiKey(c.provider);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const start = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: c.model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 256,
        }),
        signal: AbortSignal.timeout(30_000),
        // @ts-expect-error undici dispatcher not typed in standard fetch
        dispatcher: upstreamAgent,
      });
      const latencyMs = Date.now() - start;
      let preview = "";
      let promptTokens = 0;
      let completionTokens = 0;
      try {
        const json = await res.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
        preview = (json.choices?.[0]?.message?.content ?? "").slice(0, 200);
        promptTokens = json.usage?.prompt_tokens ?? 0;
        completionTokens = json.usage?.completion_tokens ?? 0;
      } catch { /* non-JSON */ }
      return {
        provider: c.provider,
        model: c.model,
        ok: res.ok,
        status: res.status,
        latencyMs,
        promptTokens,
        completionTokens,
        outputPreview: preview,
      };
    } catch (err) {
      return {
        provider: c.provider,
        model: c.model,
        ok: false,
        status: 0,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }));

  return NextResponse.json({
    reqId,
    promptLength: prompt.length,
    by: who.label,
    results,
  });
}
