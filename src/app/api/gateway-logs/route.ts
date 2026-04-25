import { NextRequest, NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";
import { cachedQuery } from "@/lib/cache";

export const dynamic = "force-dynamic";

// Cursor-based pagination: clients pass `?cursor=<id>` to get the page of rows
// strictly older than that id. `limit` is clamped 1..500. `total` is an
// approximate row count cached for 30s — exact COUNT(*) on a multi-million-row
// table at every UI poll was the bottleneck.
//
// Backwards-compat: if `?offset=` is passed and `cursor` is not, fall back to
// the offset path so existing clients keep working while they migrate.

async function getApproxTotal(): Promise<number> {
  return cachedQuery("gateway-logs:approx-total", 30_000, async () => {
    const sql = getSqlClient();
    // pg_class.reltuples is updated by ANALYZE — close enough for a UI counter
    // and constant time. Fall back to exact count if the planner has no estimate.
    const rows = await sql<{ approx: number | null }[]>`
      SELECT reltuples::bigint AS approx
      FROM pg_class WHERE oid = 'gateway_logs'::regclass
    `;
    const approx = Number(rows[0]?.approx ?? 0);
    if (approx > 0) return approx;
    const exact = await sql<{ total: number }[]>`SELECT COUNT(*)::int as total FROM gateway_logs`;
    return Number(exact[0]?.total ?? 0);
  });
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 100, 1), 500);
    const cursorRaw = searchParams.get("cursor");
    const offsetRaw = searchParams.get("offset");

    const sql = getSqlClient();

    let logs;
    if (cursorRaw !== null) {
      const cursor = Number(cursorRaw);
      if (!Number.isFinite(cursor) || cursor < 0) {
        return NextResponse.json({ error: "invalid cursor" }, { status: 400 });
      }
      logs = await sql`
        SELECT id, request_model as "requestModel", resolved_model as "resolvedModel",
               provider, status, latency_ms as "latencyMs",
               input_tokens as "inputTokens", output_tokens as "outputTokens",
               error, user_message as "userMessage", assistant_message as "assistantMessage",
               created_at as "createdAt"
        FROM gateway_logs
        WHERE id < ${cursor}
        ORDER BY id DESC
        LIMIT ${limit}
      `;
    } else {
      const offset = Math.max(Number(offsetRaw) || 0, 0);
      logs = await sql`
        SELECT id, request_model as "requestModel", resolved_model as "resolvedModel",
               provider, status, latency_ms as "latencyMs",
               input_tokens as "inputTokens", output_tokens as "outputTokens",
               error, user_message as "userMessage", assistant_message as "assistantMessage",
               created_at as "createdAt"
        FROM gateway_logs ORDER BY id DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    const total = await getApproxTotal();
    const lastRow = logs.length > 0 ? logs[logs.length - 1] : null;
    const nextCursor = lastRow ? Number((lastRow as { id: number }).id) : null;
    const hasMore = logs.length === limit;

    return NextResponse.json({
      logs,
      total,
      totalIsApproximate: true,
      limit,
      nextCursor,
      hasMore,
    });
  } catch (err) {
    console.error("[gateway-logs] error:", err);
    return NextResponse.json(
      { logs: [], total: 0, totalIsApproximate: true, limit: 100, nextCursor: null, hasMore: false },
      { status: 500 },
    );
  }
}
