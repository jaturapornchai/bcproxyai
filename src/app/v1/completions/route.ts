import { NextRequest } from "next/server";
import { getSqlClient } from "@/lib/db/schema";
import { getNextApiKey } from "@/lib/api-keys";
import { PROVIDER_COMPLETIONS_URLS } from "@/lib/providers";
import { resolveProviderCompletionsUrl } from "@/lib/provider-resolver";
import { openAIError } from "@/lib/openai-compat";
import crypto from "crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /v1/completions — Legacy text completion endpoint
 * Used by: Cody (autocomplete), older LangChain, some CLI tools
 * Converts to chat/completions internally if provider doesn't support legacy
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;

    if (!body.prompt && !body.messages) {
      return openAIError(400, { message: "prompt is required", param: "prompt" });
    }

    const modelField = (body.model as string) || "auto";
    const isStream = body.stream === true;
    const prompt = body.prompt as string | string[] | undefined;

    const sql = getSqlClient();
    const now = new Date().toISOString();

    const providersWithCompletions = Object.keys(PROVIDER_COMPLETIONS_URLS);

    const models = await sql<{ id: string; provider: string; model_id: string }[]>`
      SELECT m.id, m.provider, m.model_id
      FROM models m
      LEFT JOIN (
        SELECT hl.model_id, hl.status, hl.cooldown_until
        FROM health_logs hl
        INNER JOIN (
          SELECT model_id, MAX(id) as max_id FROM health_logs GROUP BY model_id
        ) latest ON hl.model_id = latest.model_id AND hl.id = latest.max_id
      ) h ON m.id = h.model_id
      WHERE (h.status IS NULL OR h.status = 'available')
        AND (h.cooldown_until IS NULL OR h.cooldown_until < ${now}::timestamptz)
        AND m.provider = ANY(${providersWithCompletions})
      ORDER BY RANDOM()
      LIMIT 5
    `;

    const modelList = [...models];

    // If specific model requested, try to find it
    if (modelField !== "auto" && modelField !== "sml/auto") {
      const specific = await sql<{ id: string; provider: string; model_id: string }[]>`
        SELECT id, provider, model_id FROM models
        WHERE id = ${modelField} OR model_id = ${modelField}
        LIMIT 1
      `;
      if (specific.length > 0) {
        modelList.unshift(specific[0]);
      }
    }

    // Try each model
    for (const model of modelList) {
      const url = resolveProviderCompletionsUrl(model.provider);
      if (!url) continue;

      const apiKey = getNextApiKey(model.provider);
      if (!apiKey) continue;

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        };
        if (model.provider === "openrouter") {
          headers["HTTP-Referer"] = "https://smlgateway.ai";
          headers["X-Title"] = "SMLGateway Gateway";
        }

        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...body, model: model.model_id }),
        });

        if (response.ok) {
          const respHeaders = new Headers();
          respHeaders.set("Content-Type", response.headers.get("Content-Type") || "application/json");
          respHeaders.set("X-SMLGateway-Provider", model.provider);
          respHeaders.set("X-SMLGateway-Model", model.model_id);
          respHeaders.set("Access-Control-Allow-Origin", "*");

          if (isStream && response.body) {
            return new Response(response.body, { status: 200, headers: respHeaders });
          }

          const json = await response.json();
          json.id = json.id ?? `cmpl-${crypto.randomBytes(12).toString("base64url")}`;
          json.object = "text_completion";
          json.created = json.created ?? Math.floor(Date.now() / 1000);
          json.model = json.model ?? model.model_id;

          return new Response(JSON.stringify(json), { status: 200, headers: respHeaders });
        }
      } catch {
        continue;
      }
    }

    // Fallback: convert prompt to chat/completions format internally
    const promptText = Array.isArray(prompt) ? prompt.join("\n") : (prompt ?? "");
    const chatBody = {
      model: modelField,
      messages: [{ role: "user", content: promptText }],
      stream: isStream,
      max_tokens: body.max_tokens ?? body.max_completion_tokens ?? 256,
      temperature: body.temperature ?? 0,
    };

    const chatResponse = await fetch(new URL("/v1/chat/completions", req.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chatBody),
    });

    if (!chatResponse.ok) {
      const err = await chatResponse.text();
      return openAIError(chatResponse.status, { message: err });
    }

    if (isStream && chatResponse.body) {
      const headers = new Headers();
      headers.set("Content-Type", "text/event-stream");
      headers.set("Access-Control-Allow-Origin", "*");
      return new Response(chatResponse.body, { status: 200, headers });
    }

    const chatJson = await chatResponse.json();
    const content = chatJson.choices?.[0]?.message?.content ?? "";

    const completionResponse = {
      id: `cmpl-${crypto.randomBytes(12).toString("base64url")}`,
      object: "text_completion",
      created: Math.floor(Date.now() / 1000),
      model: chatJson.model ?? modelField,
      choices: [{
        text: content,
        index: 0,
        logprobs: null,
        finish_reason: chatJson.choices?.[0]?.finish_reason ?? "stop",
      }],
      usage: chatJson.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };

    const responseHeaders = new Headers();
    responseHeaders.set("Content-Type", "application/json");
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    if (chatResponse.headers.get("X-SMLGateway-Provider")) {
      responseHeaders.set("X-SMLGateway-Provider", chatResponse.headers.get("X-SMLGateway-Provider")!);
    }

    return new Response(JSON.stringify(completionResponse), { status: 200, headers: responseHeaders });
  } catch (err) {
    console.error("[completions] error:", err);
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
