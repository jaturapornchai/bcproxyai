import { NextRequest } from "next/server";
import { ensureApiKeysLoaded, getNextApiKey } from "@/lib/api-keys";
import { resolveProviderEmbeddingUrl } from "@/lib/provider-resolver";
import { openAIError } from "@/lib/openai-compat";
import { applyNoSpendGuards, getCostAllowedProviders, isProviderCostAllowed } from "@/lib/cost-policy";
import { FREE_EMBEDDING_MODELS, isAutoModel, isFreeEmbeddingModel, pickAllowedModel } from "@/lib/free-media-models";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Providers with a verified $0 embedding model, in try order (key order of FREE_EMBEDDING_MODELS)
const EMBED_PROVIDER_ORDER = Object.keys(FREE_EMBEDDING_MODELS);

/**
 * POST /v1/embeddings — Embedding generation
 * Used by: Continue (codebase indexing), Cody, LangChain, Aider, LibreChat
 */
export async function POST(req: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return openAIError(400, { message: "Invalid JSON in request body", code: "invalid_request" });
    }

    if (!body.input) {
      return openAIError(400, { message: "input is required", param: "input" });
    }

    const requestedModel = body.model;
    if (!isAutoModel(requestedModel) && !isFreeEmbeddingModel(requestedModel)) {
      return openAIError(402, {
        message: `Embedding model '${String(requestedModel)}' is blocked by cost policy. Allowed: auto, ${Object.values(FREE_EMBEDDING_MODELS).flat().join(", ")}.`,
        code: "cost_policy_blocked",
        param: "model",
      });
    }

    // Load API keys from DB cache — required before getNextApiKey()
    await ensureApiKeysLoaded();

    // Try each embedding provider in order
    const providerOrder = EMBED_PROVIDER_ORDER.filter(isProviderCostAllowed);
    const triedReasons: string[] = [];

    for (const provider of providerOrder) {
      const embeddingModel = pickAllowedModel(requestedModel, FREE_EMBEDDING_MODELS[provider]);
      if (!embeddingModel) { triedReasons.push(`${provider}:model_not_served`); continue; }

      const url = resolveProviderEmbeddingUrl(provider);
      if (!url) { triedReasons.push(`${provider}:no_url`); continue; }

      const apiKey = getNextApiKey(provider);
      if (!apiKey) { triedReasons.push(`${provider}:no_key`); continue; }

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (apiKey) {
          headers["Authorization"] = `Bearer ${apiKey}`;
        }
        if (provider === "openrouter") {
          headers["HTTP-Referer"] = "https://bcairouter.ai";
          headers["X-Title"] = "BCAiRouter Gateway";
        }

        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(applyNoSpendGuards(provider, {
            model: embeddingModel,
            input: body.input,
            encoding_format: body.encoding_format ?? "float",
          })),
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
          respHeaders.set("X-BCAiRouter-Provider", provider);
          respHeaders.set("X-BCAiRouter-Model", embeddingModel ?? "");
          respHeaders.set("Access-Control-Allow-Origin", "*");

          return new Response(JSON.stringify(json), { status: 200, headers: respHeaders });
        }

        // Capture upstream error preview to make 503 actionable
        const errBody = await response.text().catch(() => "");
        const preview = errBody.slice(0, 120).replace(/\s+/g, " ");
        triedReasons.push(`${provider}:${response.status}(${preview})`);
        console.warn(`[embeddings] ${provider}/${embeddingModel} -> ${response.status}: ${preview}`);
        continue;
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        triedReasons.push(`${provider}:throw(${m.slice(0, 80)})`);
        console.warn(`[embeddings] ${provider} threw:`, m);
        continue;
      }
    }

    return openAIError(503, {
      message: `All embedding providers failed. Tried: ${triedReasons.join(" | ")}. Allowed providers: ${getCostAllowedProviders().join(", ")}.`,
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
