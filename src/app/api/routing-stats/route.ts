import { NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sql = getSqlClient();

    const categoryStats = await sql<{
      prompt_category: string; model_id: string; provider: string; nickname: string | null;
      total: number; successes: number; success_rate: number; avg_latency_ms: number;
    }[]>`
      SELECT
        rs.prompt_category, rs.model_id, rs.provider, m.nickname,
        COUNT(*) as total, SUM(rs.success) as successes,
        ROUND((SUM(rs.success)::numeric / COUNT(*) * 100), 1) as success_rate,
        ROUND(AVG(rs.latency_ms)::numeric) as avg_latency_ms
      FROM routing_stats rs
      JOIN models m ON rs.model_id = m.id
      WHERE rs.created_at >= now() - interval '7 days'
      GROUP BY rs.prompt_category, rs.model_id, rs.provider, m.nickname
      HAVING COUNT(*) >= 2
      ORDER BY rs.prompt_category, success_rate DESC, avg_latency_ms ASC
    `;

    type CategoryRow = { prompt_category: string; model_id: string; provider: string; nickname: string | null; total: number; successes: number; success_rate: number; avg_latency_ms: number };
    const categories: Record<string, CategoryRow[]> = {};
    for (const row of categoryStats) {
      (categories[row.prompt_category] ??= []).push(row);
    }

    const distribution = await sql<{ prompt_category: string; count: number }[]>`
      SELECT prompt_category, COUNT(*) as count
      FROM routing_stats
      WHERE created_at >= now() - interval '7 days'
      GROUP BY prompt_category
      ORDER BY count DESC
    `;

    const totalRows = await sql<{ total: number }[]>`
      SELECT COUNT(*) as total FROM routing_stats WHERE created_at >= now() - interval '7 days'
    `;
    const totalLearned = Number(totalRows[0]?.total ?? 0);

    return NextResponse.json({ categories, distribution, totalLearned });
  } catch (err) {
    console.error("[routing-stats] error:", err);
    return NextResponse.json({ categories: {}, distribution: [], totalLearned: 0 }, { status: 500 });
  }
}
