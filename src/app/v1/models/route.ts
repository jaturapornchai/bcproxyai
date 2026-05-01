import { NextRequest, NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";
import { openAIError, toOpenAIModelObject, unixNow } from "@/lib/openai-compat";
import { isModelCostAllowed } from "@/lib/cost-policy";

export const dynamic = "force-dynamic";

interface ModelRow {
  id: string;
  name: string;
  provider: string;
  model_id: string;
  context_length: number;
  tier: string;
  supports_tools: number;
  supports_vision: number;
  first_seen: Date | null;
  health_status: string | null;
  cooldown_until: Date | null;
  avg_score: number | null;
  avg_latency: number | null;
}

// Virtual sml/* models
const VIRTUAL_MODELS = [
  toOpenAIModelObject("sml/auto", "sml"),
  toOpenAIModelObject("sml/fast", "sml"),
  toOpenAIModelObject("sml/tools", "sml"),
  toOpenAIModelObject("sml/thai", "sml"),
  toOpenAIModelObject("sml/consensus", "sml"),
];

export async function GET(_req: NextRequest) {
  try {
    const sql = getSqlClient();

    const rows = await sql<ModelRow[]>`
      SELECT
        m.id, m.name, m.provider, m.model_id,
        m.context_length, m.tier, m.supports_tools, m.supports_vision, m.first_seen,
        h.status as health_status, h.cooldown_until,
        COALESCE(b.avg_score, 0) as avg_score,
        COALESCE(b.avg_latency, 0) as avg_latency
      FROM models m
      LEFT JOIN latest_model_health h ON m.id = h.model_id
      LEFT JOIN (
        SELECT model_id, AVG(score) as avg_score, AVG(latency_ms) as avg_latency
        FROM benchmark_results GROUP BY model_id
      ) b ON m.id = b.model_id
      ORDER BY avg_score DESC, m.provider ASC, m.name ASC
    `;

    const realModels = rows.filter((row) => isModelCostAllowed(row.provider, row.model_id)).map((row) => {
      const created = row.first_seen
        ? Math.floor(new Date(row.first_seen).getTime() / 1000)
        : unixNow();

      return toOpenAIModelObject(
        `${row.provider}/${row.model_id}`,
        row.provider,
        created
      );
    });

    return NextResponse.json({
      object: "list",
      data: [...VIRTUAL_MODELS, ...realModels],
    });
  } catch (err) {
    console.error("[v1/models] Error:", err);
    return openAIError(500, { message: String(err) });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
