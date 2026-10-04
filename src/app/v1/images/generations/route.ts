import { NextRequest } from "next/server";
import { openAIError } from "@/lib/openai-compat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /v1/images/generations — Image generation
 * Proxy to Pollinations.ai (free, no API key needed)
 * Models: flux, flux-realism, gpt-image-large, seedream, kontext
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;

    if (!body.prompt) {
      return openAIError(400, { message: "prompt is required", param: "prompt" });
    }

    const prompt = body.prompt as string;
    const model = (body.model as string) || "flux";
    const n = Math.min((body.n as number) || 1, 4); // max 4 images
    const size = (body.size as string) || "1024x1024";
    const [width, height] = size.split("x").map(Number);
    const responseFormat = (body.response_format as string) || "url";

    const images = await Promise.all(
      Array.from({ length: n }, async (_, i) => {
        // Pollinations rejects seeds above int32 (HTTP 402) — keep it in range
        const seed = (Date.now() + i) % 2147483647;
        const pollinationsBody = {
          model: mapImageModel(model),
          prompt,
          width: width || 1024,
          height: height || 1024,
          seed,
          nologo: true,
          enhance: false,
        };

        const response = await fetch("https://image.pollinations.ai/prompt/" + encodeURIComponent(prompt) + "?" + new URLSearchParams({
          model: pollinationsBody.model,
          width: String(pollinationsBody.width),
          height: String(pollinationsBody.height),
          seed: String(pollinationsBody.seed),
          nologo: "true",
        }).toString(), { method: "GET" });

        if (!response.ok) {
          throw Object.assign(new Error(`Pollinations error: HTTP ${response.status}`), { upstreamStatus: response.status });
        }

        if (responseFormat === "b64_json") {
          const buffer = await response.arrayBuffer();
          const b64 = Buffer.from(buffer).toString("base64");
          return { b64_json: b64, revised_prompt: prompt };
        }

        // For URL format, use the Pollinations URL directly
        const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=${pollinationsBody.model}&width=${pollinationsBody.width}&height=${pollinationsBody.height}&seed=${pollinationsBody.seed}&nologo=true`;
        return { url: imageUrl, revised_prompt: prompt };
      })
    );

    return new Response(
      JSON.stringify({
        created: Math.floor(Date.now() / 1000),
        data: images,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "X-BCAiRouter-Provider": "pollinations",
          "X-BCAiRouter-Model": model,
        },
      }
    );
  } catch (err) {
    console.error("[v1/images/generations] Error:", err);
    // anonymous Pollinations answers 402/429 when its ~1 req/15s limit is hit
    const upstream = (err as { upstreamStatus?: number }).upstreamStatus;
    if (upstream === 402 || upstream === 429) {
      return openAIError(429, { message: "Image provider rate limited (Pollinations free tier ~1 req/15s). Retry later." });
    }
    return openAIError(500, { message: String(err) });
  }
}

function mapImageModel(model?: string): string {
  const map: Record<string, string> = {
    "dall-e-2": "flux",
    "dall-e-3": "flux-realism",
    "gpt-image-1": "gpt-image-large",
  };
  return map[model ?? ""] ?? model ?? "flux";
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
