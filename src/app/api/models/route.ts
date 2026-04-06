import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/schema";
import { getCached, setCache } from "@/lib/cache";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const provider = searchParams.get("provider");

    const cacheKey = `api:models:${provider ?? "all"}`;
    const cached = getCached<unknown[]>(cacheKey);
    if (cached) return NextResponse.json(cached);

    const db = getDb();

    let whereClause = "";
    const params: unknown[] = [];
    if (provider) {
      whereClause = "WHERE m.provider = ?";
      params.push(provider);
    }

    const rows = db
      .prepare(`
        SELECT
          m.id,
          m.name,
          m.provider,
          m.model_id as modelId,
          m.context_length as contextLength,
          m.tier,
          m.nickname,
          m.supports_tools as supportsTools,
          m.supports_vision as supportsVision,
          m.first_seen as firstSeen,
          m.last_seen as lastSeen,
          h.status as healthStatus,
          h.latency_ms as latencyMs,
          h.checked_at as lastCheck,
          h.cooldown_until as cooldownUntil,
          b.avg_score as avgScore,
          b.max_score as maxScore,
          b.questions_answered as questionsAnswered,
          b.total_questions as totalQuestions
        FROM models m
        LEFT JOIN (
          SELECT hl.model_id, hl.status, hl.latency_ms, hl.checked_at, hl.cooldown_until
          FROM health_logs hl
          INNER JOIN (
            SELECT model_id, MAX(checked_at) as max_checked
            FROM health_logs
            GROUP BY model_id
          ) latest ON hl.model_id = latest.model_id AND hl.checked_at = latest.max_checked
        ) h ON m.id = h.model_id
        LEFT JOIN (
          SELECT
            model_id,
            AVG(score) as avg_score,
            MAX(max_score) as max_score,
            COUNT(*) as questions_answered,
            COUNT(*) as total_questions
          FROM benchmark_results
          GROUP BY model_id
        ) b ON m.id = b.model_id
        ${whereClause}
        ORDER BY
          CASE WHEN b.avg_score IS NOT NULL THEN 0 ELSE 1 END,
          b.avg_score DESC,
          m.context_length DESC
      `)
      .all(...params) as Array<{
      id: string;
      name: string;
      provider: string;
      modelId: string;
      contextLength: number;
      tier: string;
      nickname: string | null;
      supportsTools: number | null;
      supportsVision: number | null;
      firstSeen: string;
      lastSeen: string;
      healthStatus: string | null;
      latencyMs: number | null;
      lastCheck: string | null;
      cooldownUntil: string | null;
      avgScore: number | null;
      maxScore: number | null;
      questionsAnswered: number | null;
      totalQuestions: number | null;
    }>;

    const now = new Date();
    const result = rows.map((r) => {
      let healthStatusFinal = r.healthStatus ?? "unknown";
      if (
        r.cooldownUntil &&
        new Date(r.cooldownUntil) > now
      ) {
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
        supportsTools: r.supportsTools === 1 ? true : r.supportsTools === 0 ? false : null,
        supportsVision: r.supportsVision === 1 ? true : r.supportsVision === 0 ? false : null,
        health: {
          status: healthStatusFinal,
          latencyMs: r.latencyMs ?? 0,
          lastCheck: r.lastCheck ?? null,
          cooldownUntil: r.cooldownUntil ?? null,
        },
        benchmark:
          r.avgScore !== null
            ? {
                avgScore: Math.round((r.avgScore ?? 0) * 100) / 100,
                maxScore: r.maxScore ?? 10,
                questionsAnswered: r.questionsAnswered ?? 0,
                totalQuestions: r.totalQuestions ?? 0,
              }
            : null,
        firstSeen: r.firstSeen,
        lastSeen: r.lastSeen,
      };
    });

    setCache(cacheKey, result, 5000); // cache 5 seconds
    return NextResponse.json(result);
  } catch (err) {
    console.error("[models] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
