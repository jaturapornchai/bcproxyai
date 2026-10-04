import { NextRequest } from "next/server";
import { getNextApiKey } from "@/lib/api-keys";
import { openAIError } from "@/lib/openai-compat";
import { costPolicyBlockMessage, isProviderCostAllowed } from "@/lib/cost-policy";
import { GROQ_TTS_MODELS, pickAllowedModel } from "@/lib/free-media-models";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /v1/audio/speech — Text-to-speech
 *
 * Routing:
 *   - Thai input → msedge-tts (Microsoft Edge TTS, MIT-licensed wrapper, free,
 *     th-TH-PremwadeeNeural / th-TH-NiwatNeural neural voices)
 *   - Other languages → Groq Orpheus (free 100 req/day, EN + AR Saudi)
 */
const THAI_RE = /[฀-๿]/;
const THAI_DEFAULT_VOICE = "th-TH-PremwadeeNeural";
const THAI_VOICES: Record<string, string> = {
  female: "th-TH-PremwadeeNeural",
  male: "th-TH-NiwatNeural",
  premwadee: "th-TH-PremwadeeNeural",
  niwat: "th-TH-NiwatNeural",
};

export async function POST(req: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return openAIError(400, { message: "Invalid JSON in request body", code: "invalid_request" });
    }

    if (!body.input || typeof body.input !== "string") {
      return openAIError(400, { message: "input is required and must be a string", param: "input" });
    }

    // Thai branch — use Microsoft Edge TTS via msedge-tts (no API key needed)
    if (THAI_RE.test(body.input)) {
      return synthesizeThai(body);
    }

    // Non-Thai → Groq Orpheus
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

    // Free-plan Orpheus only; tts-1 / retired / unknown ids fall back to the default (never forwarded)
    const model = pickAllowedModel(body.model, GROQ_TTS_MODELS) ?? GROQ_TTS_MODELS[0];
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
        "X-BCAiRouter-Provider": "groq",
        "X-BCAiRouter-Model": model,
      },
    });
  } catch (err) {
    console.error("[v1/audio/speech] Error:", err);
    return openAIError(500, { message: String(err) });
  }
}

async function synthesizeThai(body: Record<string, unknown>): Promise<Response> {
  try {
    const { MsEdgeTTS, OUTPUT_FORMAT } = await import("msedge-tts");
    const requestedVoice = (body.voice as string) || "";
    const voice = requestedVoice.startsWith("th-TH-")
      ? requestedVoice
      : THAI_VOICES[requestedVoice.toLowerCase()] || THAI_DEFAULT_VOICE;

    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = await tts.toStream(body.input as string);
    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) chunks.push(chunk as Buffer);
    const audioBuffer = Buffer.concat(chunks);

    return new Response(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Access-Control-Allow-Origin": "*",
        "X-BCAiRouter-Provider": "msedge-tts",
        "X-BCAiRouter-Model": voice,
      },
    });
  } catch (err) {
    console.error("[v1/audio/speech] Edge TTS error:", err);
    return openAIError(502, {
      message: `Thai TTS provider failed: ${err instanceof Error ? err.message : String(err)}`,
      code: "upstream_error",
    });
  }
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
