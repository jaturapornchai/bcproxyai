import { NextRequest, NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";
import { getCached, setCache } from "@/lib/cache";
import { isModelCostAllowed } from "@/lib/cost-policy";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const provider = searchParams.get("provider");

    const cacheKey = `api:models:${provider ?? "all"}`;
    const cached = getCached<unknown[]>(cacheKey);
    if (cached) return NextResponse.json(cached);

    const sql = getSqlClient();

    const rows = provider
      ? await sql<Array<Record<string, unknown>>>`
          SELECT
            m.id, m.name, m.provider, m.model_id as "modelId",
            m.context_length as "contextLength", m.tier, m.nickname,
            m.supports_vision as "supportsVision", m.supports_tools as "supportsTools",
            m.first_seen as "firstSeen", m.last_seen as "lastSeen",
            h.status as "healthStatus", h.latency_ms as "latencyMs",
            h.checked_at as "lastCheck", h.cooldown_until as "cooldownUntil",
            b.avg_score as "avgScore", b.max_score as "maxScore",
            b.questions_answered as "questionsAnswered", b.total_questions as "totalQuestions"
          FROM models m
          LEFT JOIN latest_model_health h ON m.id = h.model_id
          LEFT JOIN (
            SELECT model_id, AVG(score) as avg_score, MAX(max_score) as max_score,
              COUNT(*) as questions_answered, COUNT(*) as total_questions
            FROM benchmark_results GROUP BY model_id
          ) b ON m.id = b.model_id
          WHERE m.provider = ${provider}
          ORDER BY
            CASE WHEN b.avg_score IS NOT NULL THEN 0 ELSE 1 END,
            b.avg_score DESC, m.context_length DESC
        `
      : await sql<Array<Record<string, unknown>>>`
          SELECT
            m.id, m.name, m.provider, m.model_id as "modelId",
            m.context_length as "contextLength", m.tier, m.nickname,
            m.supports_vision as "supportsVision", m.supports_tools as "supportsTools",
            m.first_seen as "firstSeen", m.last_seen as "lastSeen",
            h.status as "healthStatus", h.latency_ms as "latencyMs",
            h.checked_at as "lastCheck", h.cooldown_until as "cooldownUntil",
            b.avg_score as "avgScore", b.max_score as "maxScore",
            b.questions_answered as "questionsAnswered", b.total_questions as "totalQuestions"
          FROM models m
          LEFT JOIN latest_model_health h ON m.id = h.model_id
          LEFT JOIN (
            SELECT model_id, AVG(score) as avg_score, MAX(max_score) as max_score,
              COUNT(*) as questions_answered, COUNT(*) as total_questions
            FROM benchmark_results GROUP BY model_id
          ) b ON m.id = b.model_id
          ORDER BY
            CASE WHEN b.avg_score IS NOT NULL THEN 0 ELSE 1 END,
            b.avg_score DESC, m.context_length DESC
        `;

    // Fetch per-category scores
    const catScoreRows = await sql<Array<{ model_id: string; category: string; score_pct: number }>>`
      SELECT model_id, category, score_pct::int as score_pct
      FROM model_category_scores
      ORDER BY model_id, category
    `;
    const catScoreMap = new Map<string, Record<string, number>>();
    for (const r of catScoreRows) {
      const existing = catScoreMap.get(r.model_id) ?? {};
      existing[r.category] = r.score_pct;
      catScoreMap.set(r.model_id, existing);
    }

    const now = new Date();
    const result = rows.filter((r) => isModelCostAllowed(String(r.provider), String(r.modelId))).map((r) => {
      let healthStatusFinal = (r.healthStatus as string) ?? "unknown";
      if (r.cooldownUntil && new Date(r.cooldownUntil as string) > now) {
        healthStatusFinal = "cooldown";
      }

      return {
        id: r.id,
        name: r.name,
        nickname: r.nickname ?? null,
        provider: r.provider,
        modelId: r.modelId,
        contextLength: r.contextLength,
        tier: r.tier,
        supportsVision: r.supportsVision === 1 || r.supportsVision === true,
        supportsTools: r.supportsTools === 1 || r.supportsTools === true,
        health: {
          status: healthStatusFinal,
          latencyMs: r.latencyMs ?? 0,
          lastCheck: r.lastCheck ?? null,
          cooldownUntil: r.cooldownUntil ?? null,
        },
        benchmark:
          r.avgScore !== null && r.avgScore !== undefined
            ? {
                avgScore: Math.round((Number(r.avgScore)) * 100) / 100,
                maxScore: r.maxScore ?? 10,
                questionsAnswered: r.questionsAnswered ?? 0,
                totalQuestions: r.totalQuestions ?? 0,
              }
            : null,
        categoryScores: catScoreMap.get(r.id as string) ?? null,
        firstSeen: r.firstSeen,
        lastSeen: r.lastSeen,
      };
    });

    setCache(cacheKey, result, 5000);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[models] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
