import { NextRequest, NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";
import { isModelCostAllowed } from "@/lib/cost-policy";

export const dynamic = "force-dynamic";

/**
 * GET /v1/models/search — filter + rank models by capability
 *
 * Query params (all optional):
 *   category       — one of: thai, code, tools, vision, math, reasoning, json,
 *                    instruction, extraction, classification, comprehension, safety
 *                    (ranks by model_category_scores.score_pct DESC)
 *   min_context    — integer, filter context_length >= N
 *   max_context    — integer, filter context_length <= N
 *   supports_tools — 0 | 1 (default: any)
 *   supports_vision — 0 | 1 (default: any)
 *   supports_reasoning — 0 | 1
 *   supports_json  — 0 | 1
 *   provider       — exact match (e.g. groq, nvidia, cerebras)
 *   tier           — small | medium | large | xlarge
 *   exclude_cooldown — 1 to drop models currently in cooldown (default: 1)
 *   top            — integer (default 20, max 200)
 *
 * Response:
 *   {
 *     total: number,
 *     category: string | null,
 *     models: [{
 *       id, provider, model_id, name, context_length, tier,
 *       supports_tools, supports_vision, supports_reasoning, supports_json_mode,
 *       category_score_pct, category_passed, category_total,
 *       avg_latency_ms, cooldown_until
 *     }]
 *   }
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category");
    const minContext = Number(searchParams.get("min_context") ?? 0);
    const maxContext = Number(searchParams.get("max_context") ?? 0);
    const supportsTools = searchParams.get("supports_tools");
    const supportsVision = searchParams.get("supports_vision");
    const supportsReasoning = searchParams.get("supports_reasoning");
    const supportsJson = searchParams.get("supports_json");
    const provider = searchParams.get("provider");
    const tier = searchParams.get("tier");
    const excludeCooldown = (searchParams.get("exclude_cooldown") ?? "1") === "1";
    const top = Math.min(Math.max(Number(searchParams.get("top") ?? 20), 1), 200);

    const sql = getSqlClient();

    // Valid categories (defensive — SQL injection would need category to inject)
    const VALID_CATS = new Set([
      "thai", "code", "tools", "vision", "math", "reasoning", "json",
      "instruction", "extraction", "classification", "comprehension", "safety",
    ]);
    const cat = category && VALID_CATS.has(category) ? category : null;

    // Build filter predicates
    const filters: string[] = [];
    if (minContext > 0) filters.push(`m.context_length >= ${minContext}`);
    if (maxContext > 0) filters.push(`m.context_length <= ${maxContext}`);
    if (supportsTools === "1") filters.push(`m.supports_tools = 1`);
    if (supportsTools === "0") filters.push(`m.supports_tools = 0`);
    if (supportsVision === "1") filters.push(`m.supports_vision = 1`);
    if (supportsVision === "0") filters.push(`m.supports_vision = 0`);
    if (supportsReasoning === "1") filters.push(`m.supports_reasoning = 1`);
    if (supportsJson === "1") filters.push(`m.supports_json_mode = 1`);
    if (provider) filters.push(`m.provider = '${provider.replace(/'/g, "''")}'`);
    if (tier) filters.push(`m.tier = '${tier.replace(/'/g, "''")}'`);

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

    const cooldownJoin = excludeCooldown
      ? `LEFT JOIN LATERAL (
          SELECT cooldown_until FROM health_logs
          WHERE model_id = m.id AND cooldown_until > now()
          ORDER BY checked_at DESC LIMIT 1
        ) cd ON true`
      : "";
    const cooldownFilter = excludeCooldown ? `AND cd.cooldown_until IS NULL` : "";

    const catJoin = cat
      ? `LEFT JOIN model_category_scores mcs ON mcs.model_id = m.id AND mcs.category = '${cat}'`
      : "";
    const catOrder = cat ? `mcs.score_pct DESC NULLS LAST,` : "";
    const catScoreSel = cat
      ? `COALESCE(mcs.score_pct, 0) AS category_score_pct,
         COALESCE(mcs.passed_count, 0) AS category_passed,
         COALESCE(mcs.total_count, 0) AS category_total,`
      : `NULL::real AS category_score_pct,
         NULL::int AS category_passed,
         NULL::int AS category_total,`;

    const latJoin = `LEFT JOIN LATERAL (
      SELECT AVG(latency_ms)::int AS avg_lat
      FROM routing_stats
      WHERE model_id = m.id AND created_at >= now() - interval '24 hours'
    ) rs ON true`;

    const query = `
      SELECT
        m.id, m.provider, m.model_id, m.name, m.context_length, m.tier,
        m.supports_tools, m.supports_vision, m.supports_reasoning, m.supports_json_mode,
        ${catScoreSel}
        rs.avg_lat AS avg_latency_ms,
        ${excludeCooldown ? "cd.cooldown_until" : "NULL::timestamptz AS cooldown_until"}
      FROM models m
      ${catJoin}
      ${cooldownJoin}
      ${latJoin}
      ${whereClause} ${whereClause ? "AND" : "WHERE"} 1=1 ${cooldownFilter}
      ORDER BY ${catOrder} m.context_length DESC, rs.avg_lat ASC NULLS LAST
      LIMIT ${top}
    `;

    const rows = (await sql.unsafe(query) as Array<Record<string, unknown>>)
      .filter((row) => isModelCostAllowed(String(row.provider), String(row.model_id)));

    return NextResponse.json({
      total: rows.length,
      category: cat,
      filters: {
        min_context: minContext || null,
        max_context: maxContext || null,
        supports_tools: supportsTools,
        supports_vision: supportsVision,
        supports_reasoning: supportsReasoning,
        supports_json: supportsJson,
        provider,
        tier,
        exclude_cooldown: excludeCooldown,
      },
      models: rows,
    }, {
      headers: {
        "Cache-Control": "public, max-age=30",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: { message: String(err), type: "search_error" } },
      { status: 500 }
    );
  }
}
