import { NextRequest } from "next/server";
import { getNextApiKey } from "@/lib/api-keys";
import { openAIError } from "@/lib/openai-compat";
import { costPolicyBlockMessage, isProviderCostAllowed } from "@/lib/cost-policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /v1/audio/speech — Text-to-speech
 * Proxy to Groq Orpheus TTS (free: 100 req/day)
 * Models: playai/PlayDialog, canopylabs/orpheus-v1-english
 * Voices: austin, daniel, troy, diana, hannah, autumn
 */
export async function POST(req: NextRequest) {
  try {
    if (!isProviderCostAllowed("groq")) {
      return openAIError(402, {
        message: costPolicyBlockMessage("groq"),
        code: "cost_policy_blocked",
      });
    }

    const apiKey = getNextApiKey("groq");
    if (!apiKey) {
      return openAIError(503, {
        message: "No Groq API key configured. Set GROQ_API_KEY in .env.local for text-to-speech.",
        code: "provider_unavailable",
      });
    }

    const body = (await req.json()) as Record<string, unknown>;

    if (!body.input) {
      return openAIError(400, { message: "input is required", param: "input" });
    }

    // Map OpenAI model names to Groq TTS models
    const model = mapTTSModel(body.model as string);
    const voice = (body.voice as string) || "austin";
    const responseFormat = (body.response_format as string) || "wav";

    const response = await fetch("https://api.groq.com/openai/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: body.input,
        voice,
        response_format: responseFormat,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return openAIError(response.status, {
        message: `Groq TTS error: ${errText}`,
        code: "upstream_error",
      });
    }

    // Return audio binary directly
    const audioBuffer = await response.arrayBuffer();
    const contentType =
      responseFormat === "mp3" ? "audio/mpeg" :
      responseFormat === "opus" ? "audio/opus" :
      responseFormat === "flac" ? "audio/flac" :
      "audio/wav";

    return new Response(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "X-SMLGateway-Provider": "groq",
        "X-SMLGateway-Model": model,
      },
    });
  } catch (err) {
    console.error("[v1/audio/speech] Error:", err);
    return openAIError(500, { message: String(err) });
  }
}

function mapTTSModel(model?: string): string {
  if (!model || model === "tts-1" || model === "tts-1-hd") {
    return "playai/PlayDialog";
  }
  // Allow direct Groq model names
  if (model.includes("/") || model.includes("orpheus") || model.includes("playai") || model.includes("PlayDialog")) {
    return model;
  }
  return "playai/PlayDialog";
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
