import { NextRequest } from "next/server";
import { getNextApiKey } from "@/lib/api-keys";
import { openAIError } from "@/lib/openai-compat";
import { costPolicyBlockMessage, isProviderCostAllowed } from "@/lib/cost-policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /v1/audio/transcriptions — Speech-to-text
 * Proxy to Groq Whisper (free: 2,000 req/day, whisper-large-v3-turbo)
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
        message: "No Groq API key configured. Set GROQ_API_KEY in .env.local for speech-to-text.",
        code: "provider_unavailable",
      });
    }

    // Forward the multipart form data as-is to Groq
    const formData = await req.formData();

    // Default model to whisper-large-v3-turbo if not specified
    if (!formData.get("model")) {
      formData.set("model", "whisper-large-v3-turbo");
    }

    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return openAIError(response.status, {
        message: `Groq Whisper error: ${errText}`,
        code: "upstream_error",
      });
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "X-SMLGateway-Provider": "groq",
        "X-SMLGateway-Model": String(formData.get("model")),
      },
    });
  } catch (err) {
    console.error("[v1/audio/transcriptions] Error:", err);
    return openAIError(500, { message: String(err) });
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
