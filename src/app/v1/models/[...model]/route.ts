import { NextRequest, NextResponse } from "next/server";
import { openAIError, toOpenAIModelObject, unixNow } from "@/lib/openai-compat";
import { FREE_MODEL_CATALOG } from "@/lib/free-model-catalog";

export const dynamic = "force-dynamic";

// Virtual sml/* models — must match entries in /v1/models/route.ts
const VIRTUAL_MODELS: Record<string, { description: string }> = {
  "sml/auto": { description: "Best available model (highest benchmark score)" },
  "sml/fast": { description: "Fastest model (lowest latency)" },
  "sml/tools": { description: "Best model that supports tool calling" },
  "sml/thai": { description: "Best model for Thai language" },
  "sml/consensus": { description: "Send to 3 models, pick best answer" },
};

/**
 * GET /v1/models/:modelId
 *
 * Catch-all so multi-segment ids (e.g. "sml/tools", "groq/moonshotai/kimi-k2")
 * resolve correctly. Next.js' single-segment [model] route would 404 with
 * Next's default HTML page, breaking OpenAI SDK clients that pre-validate
 * model existence.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ model: string[] }> }
) {
  try {
    const { model: segments } = await params;
    const modelId = Array.isArray(segments)
      ? segments.map(decodeURIComponent).join("/")
      : decodeURIComponent(String(segments ?? ""));

    if (!modelId) {
      return openAIError(400, { message: "Model id required", param: "model" });
    }

    // Virtual models first
    if (VIRTUAL_MODELS[modelId]) {
      return NextResponse.json(
        toOpenAIModelObject(modelId, "sml", unixNow()),
        { headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    const row = FREE_MODEL_CATALOG.find((m) =>
      m.modelId === modelId ||
      `${m.provider}/${m.modelId}` === modelId ||
      `${m.provider}:${m.modelId}` === modelId
    );

    if (!row) {
      return openAIError(404, {
        message: `The model '${modelId}' does not exist`,
        param: "model",
      });
    }

    return NextResponse.json(
      toOpenAIModelObject(`${row.provider}/${row.modelId}`, row.provider, unixNow()),
      { headers: { "Access-Control-Allow-Origin": "*" } }
    );
  } catch (err) {
    console.error("[v1/models/:id] Error:", err);
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
