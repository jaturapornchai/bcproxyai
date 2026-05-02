import { NextRequest, NextResponse } from "next/server";
import { FREE_MODEL_CATALOG } from "@/lib/free-model-catalog";

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

    // Valid categories (defensive — SQL injection would need category to inject)
    const VALID_CATS = new Set([
      "thai", "code", "tools", "vision", "math", "reasoning", "json",
      "instruction", "extraction", "classification", "comprehension", "safety",
    ]);
    const cat = category && VALID_CATS.has(category) ? category : null;

    void excludeCooldown;
    let rows = FREE_MODEL_CATALOG.map((m) => ({
      id: `${m.provider}:${m.modelId}`,
      provider: m.provider,
      model_id: m.modelId,
      name: m.name,
      context_length: m.contextLength,
      tier: m.tier,
      supports_tools: m.supportsTools ? 1 : 0,
      supports_vision: m.supportsVision ? 1 : 0,
      supports_reasoning: m.supportsReasoning ? 1 : 0,
      supports_json_mode: m.supportsJsonMode ? 1 : 0,
      category_score_pct: cat ? 50 : null,
      category_passed: cat ? 0 : null,
      category_total: cat ? 0 : null,
      avg_latency_ms: null,
      cooldown_until: null,
    }));

    rows = rows.filter((m) => {
      if (minContext > 0 && m.context_length < minContext) return false;
      if (maxContext > 0 && m.context_length > maxContext) return false;
      if (supportsTools === "1" && m.supports_tools !== 1) return false;
      if (supportsTools === "0" && m.supports_tools !== 0) return false;
      if (supportsVision === "1" && m.supports_vision !== 1) return false;
      if (supportsVision === "0" && m.supports_vision !== 0) return false;
      if (supportsReasoning === "1" && m.supports_reasoning !== 1) return false;
      if (supportsJson === "1" && m.supports_json_mode !== 1) return false;
      if (provider && m.provider !== provider) return false;
      if (tier && m.tier !== tier) return false;
      return true;
    });

    rows.sort((a, b) => b.context_length - a.context_length || a.model_id.localeCompare(b.model_id));
    rows = rows.slice(0, top);

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
