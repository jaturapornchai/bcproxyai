import { NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sql = getSqlClient();

    const providerStats = await sql<{ provider: string; total: number; success: number; successRate: number; avgLatencyMs: number }[]>`
      SELECT
        provider,
        COUNT(*) as total,
        SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) as success,
        ROUND(
          (SUM(CASE WHEN status >= 200 AND status < 300 THEN 1.0 ELSE 0.0 END)::numeric / COUNT(*) * 100),
          1
        ) as "successRate",
        ROUND(AVG(latency_ms)::numeric) as "avgLatencyMs"
      FROM gateway_logs
      WHERE created_at >= now() - interval '24 hours'
      GROUP BY provider
      ORDER BY total DESC
    `;

    const hourlyRaw = await sql<{ hour: string; total: number; success: number; failed: number }[]>`
      SELECT
        to_char(created_at, 'HH24') as hour,
        COUNT(*) as total,
        SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN status < 200 OR status >= 300 THEN 1 ELSE 0 END) as failed
      FROM gateway_logs
      WHERE created_at >= now() - interval '24 hours'
      GROUP BY to_char(created_at, 'HH24')
      ORDER BY hour
    `;

    const hourMap = new Map(hourlyRaw.map((h) => [h.hour, h]));
    const hourlyVolume = Array.from({ length: 24 }, (_, i) => {
      const hour = String(i).padStart(2, "0");
      return hourMap.get(hour) ?? { hour, total: 0, success: 0, failed: 0 };
    });

    const topModels = await sql<{ model: string; provider: string; count: number; avgLatencyMs: number }[]>`
      SELECT
        COALESCE(resolved_model, request_model) as model,
        provider,
        COUNT(*) as count,
        ROUND(AVG(latency_ms)::numeric) as "avgLatencyMs"
      FROM gateway_logs
      WHERE created_at >= now() - interval '24 hours'
      GROUP BY COALESCE(resolved_model, request_model), provider
      ORDER BY count DESC
      LIMIT 10
    `;

    const dailyTokens = await sql<{ date: string; input: number; output: number }[]>`
      SELECT
        to_char(created_at, 'YYYY-MM-DD') as date,
        SUM(input_tokens) as input,
        SUM(output_tokens) as output
      FROM token_usage
      WHERE created_at >= now() - interval '7 days'
      GROUP BY to_char(created_at, 'YYYY-MM-DD')
      ORDER BY date
    `;

    return NextResponse.json({ providerStats, hourlyVolume, topModels, dailyTokens });
  } catch (err) {
    console.error("[analytics] error:", err);
    return NextResponse.json(
      { providerStats: [], hourlyVolume: [], topModels: [], dailyTokens: [] },
      { status: 500 }
    );
  }
}
