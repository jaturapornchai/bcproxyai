import { NextRequest, NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";
import { openAIError, toOpenAIModelObject, unixNow } from "@/lib/openai-compat";

export const dynamic = "force-dynamic";

// Virtual sml/* models
const VIRTUAL_MODELS: Record<string, { description: string }> = {
  "sml/auto": { description: "Best available model (highest benchmark score)" },
  "sml/fast": { description: "Fastest model (lowest latency)" },
  "sml/tools": { description: "Best model that supports tool calling" },
  "sml/thai": { description: "Best model for Thai language" },
  "sml/consensus": { description: "Send to 3 models, pick best answer" },
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ model: string }> }
) {
  try {
    const { model: modelParam } = await params;
    const modelId = decodeURIComponent(modelParam);

    // Check virtual models
    if (VIRTUAL_MODELS[modelId]) {
      return NextResponse.json(
        toOpenAIModelObject(modelId, "sml", unixNow()),
        { headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    const sql = getSqlClient();
    const rows = await sql<{ provider: string; model_id: string; first_seen: Date | null }[]>`
      SELECT m.provider, m.model_id, m.first_seen
      FROM models m
      WHERE m.model_id = ${modelId} OR (m.provider || '/' || m.model_id) = ${modelId}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return openAIError(404, {
        message: `The model '${modelId}' does not exist`,
        param: "model",
      });
    }

    const row = rows[0];
    const created = row.first_seen
      ? Math.floor(new Date(row.first_seen).getTime() / 1000)
      : unixNow();

    return NextResponse.json(
      toOpenAIModelObject(`${row.provider}/${row.model_id}`, row.provider, created),
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
