import { NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/**
 * /api/routing-explain — recent routing decisions list (admin/debug view).
 *
 * Returns the last N gateway log rows that have a routing_explain JSONB
 * payload. Each row is decision metadata only — no prompt content. Use
 * /v1/trace/:reqId for the full single-request view (includes redacted
 * user_message + assistant_message preview).
 */

interface Row {
  request_id: string | null;
  request_model: string;
  resolved_model: string | null;
  provider: string | null;
  status: number;
  latency_ms: number;
  routing_explain: unknown;
  created_at: string;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rawLimit = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.max(Math.floor(rawLimit), 1), 200)
      : 30;

    const onlyFallback = url.searchParams.get("fallback") === "1";
    const onlyError = url.searchParams.get("error") === "1";

    const sql = getSqlClient();
    const rows = await sql<Row[]>`
      SELECT request_id, request_model, resolved_model, provider,
             status, latency_ms, routing_explain, created_at::text
      FROM gateway_logs
      WHERE routing_explain IS NOT NULL
        ${onlyError ? sql`AND status >= 400` : sql``}
        ${onlyFallback ? sql`AND (routing_explain ->> 'fallbackUsed')::boolean = true` : sql``}
      ORDER BY id DESC
      LIMIT ${limit}
    `;

    return NextResponse.json({
      total: rows.length,
      entries: rows.map((r) => ({
        requestId: r.request_id,
        requestModel: r.request_model,
        resolvedModel: r.resolved_model,
        provider: r.provider,
        status: r.status,
        latencyMs: r.latency_ms,
        explain: r.routing_explain,
        at: r.created_at,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 500 });
  }
}
