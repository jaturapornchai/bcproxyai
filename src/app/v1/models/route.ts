import { NextRequest, NextResponse } from "next/server";
import { openAIError, toOpenAIModelObject, unixNow } from "@/lib/openai-compat";
import { getActiveFreeModelCatalog } from "@/lib/free-model-catalog";

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

// Virtual bcai/* models
const VIRTUAL_MODELS = [
  toOpenAIModelObject("bcai/auto", "bcai"),
  toOpenAIModelObject("bcai/fast", "bcai"),
  toOpenAIModelObject("bcai/tools", "bcai"),
  toOpenAIModelObject("bcai/thai", "bcai"),
  toOpenAIModelObject("bcai/consensus", "bcai"),
];

export async function GET(_req: NextRequest) {
  try {
    const created = unixNow();
    const realModels = getActiveFreeModelCatalog().map((row) =>
      toOpenAIModelObject(`${row.provider}/${row.modelId}`, row.provider, created)
    );

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
