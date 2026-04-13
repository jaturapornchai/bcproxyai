import { NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";
import { getCached, setCache } from "@/lib/cache";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cached = getCached<unknown>("api:leaderboard");
    if (cached) return NextResponse.json(cached);

    const sql = getSqlClient();

    const rows = await sql<Array<{
      name: string; provider: string; modelId: string; tier: string;
      supportsVision: number; avgScore: number; totalScore: number;
      maxScore: number; questionsAnswered: number; avgLatencyMs: number;
    }>>`
      SELECT
        m.name, m.provider, m.model_id as "modelId", m.tier,
        m.supports_vision as "supportsVision",
        AVG(b.score) as "avgScore", SUM(b.score) as "totalScore",
        SUM(b.max_score) as "maxScore", COUNT(b.id) as "questionsAnswered",
        AVG(b.latency_ms) as "avgLatencyMs"
      FROM benchmark_results b
      INNER JOIN models m ON b.model_id = m.id
      GROUP BY b.model_id, m.name, m.provider, m.model_id, m.tier, m.supports_vision
      HAVING COUNT(b.id) >= 1
      ORDER BY AVG(b.score) DESC, SUM(b.score) DESC
    `;

    // Per-category scores for each model
    const result = await Promise.all(rows.map(async (r, i) => {
      const catRows = await sql<{ category: string; avg_score: number; q_count: number }[]>`
        SELECT category, AVG(score) as avg_score, COUNT(*) as q_count
        FROM benchmark_results
        WHERE model_id = ${r.modelId}
        GROUP BY category
      `;

      let categories: Record<string, number> = {};
      if (catRows.length === 0) {
        const modelRow = await sql<{ id: string }[]>`
          SELECT id FROM models WHERE model_id = ${r.modelId} LIMIT 1
        `;
        if (modelRow.length > 0) {
          const catRows2 = await sql<{ category: string; avg_score: number }[]>`
            SELECT category, AVG(score) as avg_score
            FROM benchmark_results WHERE model_id = ${modelRow[0].id}
            GROUP BY category
          `;
          categories = Object.fromEntries(catRows2.map(c => [c.category, Math.round(Number(c.avg_score) * 10) / 10]));
        }
      } else {
        categories = Object.fromEntries(catRows.map(c => [c.category, Math.round(Number(c.avg_score) * 10) / 10]));
      }

      return {
        rank: i + 1,
        name: r.name,
        provider: r.provider,
        modelId: r.modelId,
        avgScore: Math.round(Number(r.avgScore) * 100) / 100,
        totalScore: Math.round(Number(r.totalScore) * 100) / 100,
        maxScore: r.maxScore,
        percentage: r.maxScore > 0 ? Math.round((Number(r.totalScore) / Number(r.maxScore)) * 100) : 0,
        questionsAnswered: r.questionsAnswered,
        avgLatencyMs: Math.round(Number(r.avgLatencyMs)),
        tier: r.tier,
        supportsVision: r.supportsVision === 1,
        categories,
      };
    }));

    setCache("api:leaderboard", result, 5000);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[leaderboard] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
