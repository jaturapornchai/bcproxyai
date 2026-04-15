import { NextRequest, NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/**
 * GET /api/my-stats?window=24h
 *
 * Returns usage stats for the calling IP.
 * Windows: 1h, 6h, 24h (default), 7d, 30d
 *
 * Response:
 *   {
 *     clientIp,
 *     window,
 *     total,
 *     success,
 *     error,
 *     success_rate,
 *     p50_latency_ms,
 *     p95_latency_ms,
 *     p99_latency_ms,
 *     input_tokens,
 *     output_tokens,
 *     top_models: [{ provider, model, count }],
 *     by_hour: [{ hour, count, success }]
 *   }
 */
export async function GET(req: NextRequest) {
  try {
    // Resolve client IP (same logic as chat route)
    const xffChain = req.headers.get("x-forwarded-for")?.split(",").map(s => s.trim()).filter(Boolean) ?? [];
    const clientIp = req.headers.get("x-real-ip")?.trim()
      ?? xffChain[xffChain.length - 1]
      ?? "unknown";

    const { searchParams } = new URL(req.url);
    const win = searchParams.get("window") ?? "24h";
    const intervalMap: Record<string, string> = {
      "1h": "1 hour",
      "6h": "6 hours",
      "24h": "24 hours",
      "7d": "7 days",
      "30d": "30 days",
    };
    const interval = intervalMap[win] ?? "24 hours";

    const sql = getSqlClient();

    const summary = await sql<Array<{
      total: number; success: number; error: number;
      p50: number | null; p95: number | null; p99: number | null;
      input_tokens: number; output_tokens: number;
    }>>`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status >= 200 AND status < 300)::int AS success,
        COUNT(*) FILTER (WHERE status >= 400)::int AS error,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms)::int AS p50,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::int AS p95,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms)::int AS p99,
        COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
        COALESCE(SUM(output_tokens), 0)::int AS output_tokens
      FROM gateway_logs
      WHERE client_ip = ${clientIp}
        AND created_at >= now() - ${interval}::interval
    `;

    const topModels = await sql<Array<{ provider: string; model: string; count: number }>>`
      SELECT provider, resolved_model AS model, COUNT(*)::int AS count
      FROM gateway_logs
      WHERE client_ip = ${clientIp}
        AND created_at >= now() - ${interval}::interval
        AND resolved_model IS NOT NULL
      GROUP BY provider, resolved_model
      ORDER BY count DESC
      LIMIT 10
    `;

    const byHour = await sql<Array<{ hour: string; count: number; success: number }>>`
      SELECT
        to_char(date_trunc('hour', created_at), 'YYYY-MM-DD HH24:00') AS hour,
        COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE status >= 200 AND status < 300)::int AS success
      FROM gateway_logs
      WHERE client_ip = ${clientIp}
        AND created_at >= now() - ${interval}::interval
      GROUP BY 1
      ORDER BY 1
    `;

    const s = summary[0] ?? { total: 0, success: 0, error: 0, p50: null, p95: null, p99: null, input_tokens: 0, output_tokens: 0 };

    return NextResponse.json({
      client_ip: clientIp,
      window: win,
      total: s.total,
      success: s.success,
      error: s.error,
      success_rate: s.total > 0 ? Number(((s.success / s.total) * 100).toFixed(2)) : null,
      p50_latency_ms: s.p50,
      p95_latency_ms: s.p95,
      p99_latency_ms: s.p99,
      input_tokens: s.input_tokens,
      output_tokens: s.output_tokens,
      top_models: topModels,
      by_hour: byHour,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: { message: String(err), type: "stats_error" } },
      { status: 500 }
    );
  }
}
