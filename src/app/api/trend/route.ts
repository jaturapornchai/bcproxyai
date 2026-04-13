import { NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sql = getSqlClient();

    const benchmarkTrend = await sql<{ date: string; provider: string; avg_score: number; models_tested: number }[]>`
      SELECT
        to_char(br.tested_at, 'YYYY-MM-DD') as date,
        m.provider,
        ROUND(AVG(br.score)::numeric, 2) as avg_score,
        COUNT(DISTINCT m.id) as models_tested
      FROM benchmark_results br
      JOIN models m ON br.model_id = m.id
      WHERE br.tested_at >= now() - interval '14 days'
      GROUP BY to_char(br.tested_at, 'YYYY-MM-DD'), m.provider
      ORDER BY date, m.provider
    `;

    const complaintTrend = await sql<{ date: string; provider: string; complaints: number; failed_exams: number }[]>`
      SELECT
        to_char(c.created_at, 'YYYY-MM-DD') as date,
        m.provider,
        COUNT(*) as complaints,
        SUM(CASE WHEN c.status = 'exam_failed' THEN 1 ELSE 0 END) as failed_exams
      FROM complaints c
      JOIN models m ON c.model_id = m.id
      WHERE c.created_at >= now() - interval '14 days'
      GROUP BY to_char(c.created_at, 'YYYY-MM-DD'), m.provider
      ORDER BY date, m.provider
    `;

    const latencyTrend = await sql<{ date: string; provider: string; avg_latency: number; requests: number }[]>`
      SELECT
        to_char(created_at, 'YYYY-MM-DD') as date,
        provider,
        ROUND(AVG(latency_ms)::numeric) as avg_latency,
        COUNT(*) as requests
      FROM gateway_logs
      WHERE created_at >= now() - interval '14 days'
        AND status >= 200 AND status < 300
        AND provider IS NOT NULL
      GROUP BY to_char(created_at, 'YYYY-MM-DD'), provider
      ORDER BY date, provider
    `;

    const dates: string[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      dates.push(d.toISOString().slice(0, 10));
    }

    return NextResponse.json({ dates, benchmarkTrend, complaintTrend, latencyTrend });
  } catch (err) {
    console.error("[trend] error:", err);
    return NextResponse.json({ dates: [], benchmarkTrend: [], complaintTrend: [], latencyTrend: [] }, { status: 500 });
  }
}
