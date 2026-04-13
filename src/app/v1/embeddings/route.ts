import { NextRequest } from "next/server";
import { getNextApiKey } from "@/lib/api-keys";
import { PROVIDER_EMBEDDING_URLS } from "@/lib/providers";
import { openAIError } from "@/lib/openai-compat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Default embedding models per provider
const DEFAULT_EMBEDDING_MODELS: Record<string, string> = {
  openrouter: "openai/text-embedding-3-small",
  mistral: "mistral-embed",
  ollama: "nomic-embed-text",
};

/**
 * POST /v1/embeddings — Embedding generation
 * Used by: Continue (codebase indexing), Cody, LangChain, Aider, LibreChat
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;

    if (!body.input) {
      return openAIError(400, { message: "input is required", param: "input" });
    }

    const requestedModel = (body.model as string) || "auto";

    // Try each embedding provider in order
    const providerOrder = ["ollama", "mistral", "openrouter"];

    for (const provider of providerOrder) {
      const url = PROVIDER_EMBEDDING_URLS[provider];
      if (!url) continue;

      const apiKey = getNextApiKey(provider);
      if (!apiKey && provider !== "ollama") continue;

      const embeddingModel = requestedModel === "auto" || requestedModel === "sml/auto"
        ? DEFAULT_EMBEDDING_MODELS[provider]
        : requestedModel;

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (apiKey) {
          headers["Authorization"] = `Bearer ${apiKey}`;
        }
        if (provider === "openrouter") {
          headers["HTTP-Referer"] = "https://smlgateway.ai";
          headers["X-Title"] = "SMLGateway Gateway";
        }

        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: embeddingModel,
            input: body.input,
            encoding_format: body.encoding_format ?? "float",
          }),
        });

        if (response.ok) {
          const json = await response.json();

          // Ensure standard format
          json.object = "list";
          if (Array.isArray(json.data)) {
            for (let i = 0; i < json.data.length; i++) {
              json.data[i].object = "embedding";
              json.data[i].index = json.data[i].index ?? i;
            }
          }
          json.model = json.model ?? embeddingModel;
          json.usage = json.usage ?? { prompt_tokens: 0, total_tokens: 0 };

          const respHeaders = new Headers();
          respHeaders.set("Content-Type", "application/json");
          respHeaders.set("X-SMLGateway-Provider", provider);
          respHeaders.set("X-SMLGateway-Model", embeddingModel ?? "");
          respHeaders.set("Access-Control-Allow-Origin", "*");

          return new Response(JSON.stringify(json), { status: 200, headers: respHeaders });
        }

        // Provider returned error, try next
        continue;
      } catch {
        continue;
      }
    }

    return openAIError(503, {
      message: "No embedding providers available. Configure Ollama, Mistral, or OpenRouter API keys.",
    });
  } catch (err) {
    console.error("[embeddings] error:", err);
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
