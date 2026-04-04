import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/schema";
import { getNextApiKey, markKeyCooldown } from "@/lib/api-keys";
import { PROVIDER_URLS } from "@/lib/providers";
import { getCached, setCache, clearCache } from "@/lib/cache";
import { compressMessages } from "@/lib/prompt-compress";
import { jsonrepair } from "jsonrepair";
import { v4 as uuidv4 } from "uuid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Budget check: returns { ok, percentUsed } — blocks at 95%
function checkBudget(): { ok: boolean; preferCheap: boolean; percentUsed: number } {
  try {
    const db = getDb();
    const configRow = db.prepare("SELECT value FROM budget_config WHERE key = 'daily_token_limit'").get() as { value: string } | undefined;
    const dailyLimit = configRow ? Number(configRow.value) : 1000000;

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const usage = db.prepare(
      "SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS total FROM token_usage WHERE created_at >= ?"
    ).get(`${today}T00:00:00`) as { total: number };

    const percentUsed = dailyLimit > 0 ? (usage.total / dailyLimit) * 100 : 0;
    return {
      ok: percentUsed < 95,
      preferCheap: percentUsed >= 80,
      percentUsed,
    };
  } catch {
    return { ok: true, preferCheap: false, percentUsed: 0 };
  }
}

// Track token usage after a successful response
function trackTokenUsage(provider: string, modelId: string, inputTokens: number, outputTokens: number) {
  try {
    const db = getDb();
    db.prepare(
      "INSERT INTO token_usage (provider, model_id, input_tokens, output_tokens, estimated_cost_usd) VALUES (?, ?, ?, ?, 0)"
    ).run(provider, modelId, inputTokens, outputTokens);
  } catch {
    // non-critical
  }
}

interface ModelRow {
  id: string;
  provider: string;
  model_id: string;
  supports_tools: number;
  supports_vision: number;
  tier: string;
  avg_score: number | null;
  avg_latency: number | null;
  health_status: string | null;
  cooldown_until: string | null;
}

interface RequestCapabilities {
  hasTools: boolean;
  hasImages: boolean;
  needsJsonSchema: boolean;
}

function detectRequestCapabilities(body: Record<string, unknown>): RequestCapabilities {
  const hasTools = Array.isArray(body.tools) && (body.tools as unknown[]).length > 0;

  // Check if any message contains image_url content
  const messages = (body.messages as Array<{ role: string; content: unknown }>) || [];
  let hasImages = false;
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const part of msg.content as Array<{ type: string }>) {
        if (part.type === "image_url") {
          hasImages = true;
          break;
        }
      }
    }
    if (hasImages) break;
  }

  // Check for json_schema response_format
  const responseFormat = body.response_format as { type?: string; json_schema?: unknown } | undefined;
  const needsJsonSchema =
    responseFormat?.type === "json_schema" && responseFormat?.json_schema != null;

  return { hasTools, hasImages, needsJsonSchema };
}

// Rough token estimate: ~4 chars per token for English, ~2 for Thai/CJK
function estimateTokens(body: Record<string, unknown>): number {
  const str = JSON.stringify(body.messages ?? []);
  // Mix of Thai + English → ~3 chars per token average
  return Math.ceil(str.length / 3);
}

function getAvailableModels(caps: RequestCapabilities): ModelRow[] {
  // No cache — SQLite query < 1ms, cache causes Ollama priority issues

  const db = getDb();
  const now = new Date().toISOString();

  const filters: string[] = [
    "(h.status IS NULL OR h.status = 'available' OR h.status = 'error')",
    "(h.cooldown_until IS NULL OR h.cooldown_until < ?)",
  ];
  if (caps.hasTools) filters.push("m.supports_tools = 1");
  if (caps.hasImages) filters.push("m.supports_vision = 1");
  // No context filter — let provider return 413 if too large, gateway will fallback

  const whereClause = filters.join(" AND ");
  // Prioritize: benchmarked models first (score > 0), then by score, then large context, then latency
  const orderClause = caps.needsJsonSchema
    ? "CASE WHEN m.tier = 'large' THEN 0 ELSE 1 END ASC, CASE WHEN avg_score > 0 THEN 0 ELSE 1 END ASC, avg_score DESC, m.context_length DESC, avg_latency ASC"
    : "CASE WHEN avg_score > 0 THEN 0 ELSE 1 END ASC, avg_score DESC, m.context_length DESC, avg_latency ASC";

  const rows = db
    .prepare(
      `
      SELECT
        m.id,
        m.provider,
        m.model_id,
        m.supports_tools,
        m.supports_vision,
        m.tier,
        m.context_length,
        COALESCE(b.avg_score, 0) as avg_score,
        COALESCE(b.avg_latency, 9999999) as avg_latency,
        h.status as health_status,
        h.cooldown_until
      FROM models m
      LEFT JOIN (
        SELECT model_id, AVG(score) as avg_score, AVG(latency_ms) as avg_latency
        FROM benchmark_results
        GROUP BY model_id
      ) b ON m.id = b.model_id
      LEFT JOIN (
        SELECT hl.model_id, hl.status, hl.cooldown_until
        FROM health_logs hl
        INNER JOIN (
          SELECT model_id, MAX(checked_at) as max_checked
          FROM health_logs
          GROUP BY model_id
        ) latest ON hl.model_id = latest.model_id AND hl.checked_at = latest.max_checked
      ) h ON m.id = h.model_id
      WHERE ${whereClause}
      ORDER BY ${orderClause}
    `
    )
    .all(now) as ModelRow[];

  return rows;
}

function logGateway(
  requestModel: string,
  resolvedModel: string | null,
  provider: string | null,
  status: number,
  latencyMs: number,
  inputTokens: number,
  outputTokens: number,
  error: string | null,
  userMessage: string | null,
  assistantMessage: string | null
) {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO gateway_logs (request_model, resolved_model, provider, status, latency_ms, input_tokens, output_tokens, error, user_message, assistant_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      requestModel,
      resolvedModel,
      provider,
      status,
      latencyMs,
      inputTokens,
      outputTokens,
      error,
      userMessage?.slice(0, 500) ?? null,
      assistantMessage?.slice(0, 500) ?? null
    );
  } catch {
    // non-critical
  }
}

function extractUserMessage(body: Record<string, unknown>): string | null {
  const messages = body.messages as Array<{ role: string; content: unknown }> | undefined;
  if (!messages || messages.length === 0) return null;
  const last = messages[messages.length - 1];
  if (typeof last.content === "string") return last.content.slice(0, 500);
  return JSON.stringify(last.content).slice(0, 500);
}

function logCooldown(modelId: string, errorMsg: string, httpStatus = 0) {
  try {
    const db = getDb();
    // Smart cooldown based on error type
    let cooldownMs: number;
    if (httpStatus === 413) {
      cooldownMs = 15 * 60 * 1000;    // 15 นาที — request ใหญ่เกินไป (ลองใหม่ได้เร็ว)
    } else if (httpStatus === 429) {
      cooldownMs = 30 * 60 * 1000;    // 30 นาที — rate limit
    } else if (httpStatus === 400) {
      cooldownMs = 10 * 60 * 1000;    // 10 นาที — bad request (อาจเป็น rate limit แฝง)
    } else if (httpStatus >= 500) {
      cooldownMs = 60 * 60 * 1000;    // 1 ชม. — server error (provider มีปัญหา)
    } else if (httpStatus === 401 || httpStatus === 403) {
      cooldownMs = 24 * 60 * 60 * 1000; // 24 ชม. — auth error (key หมดอายุ/ผิด)
    } else {
      cooldownMs = 30 * 60 * 1000;    // 30 นาที — default
    }
    const cooldownUntil = new Date(Date.now() + cooldownMs).toISOString();
    db.prepare(
      `INSERT INTO health_logs (model_id, status, error, cooldown_until, checked_at)
       VALUES (?, 'rate_limited', ?, ?, datetime('now'))`
    ).run(modelId, errorMsg, cooldownUntil);
    // Clear model cache so next request gets fresh data
    clearCache("models:");
    clearCache("allmodels:");
  } catch {
    // non-critical
  }
}

function parseModelField(model: string): {
  mode: "auto" | "fast" | "tools" | "thai" | "consensus" | "direct" | "match";
  provider?: string;
  modelId?: string;
} {
  if (!model || model === "auto" || model === "bcproxy/auto") {
    return { mode: "auto" };
  }
  if (model === "bcproxy/fast") return { mode: "fast" };
  if (model === "bcproxy/tools") return { mode: "tools" };
  if (model === "bcproxy/thai") return { mode: "thai" };
  if (model === "bcproxy/consensus") return { mode: "consensus" };

  // openrouter/xxx, kilo/xxx, groq/xxx
  const providerMatch = model.match(/^(openrouter|kilo|groq|cerebras|sambanova|mistral|ollama)\/(.+)$/);
  if (providerMatch) {
    return { mode: "direct", provider: providerMatch[1], modelId: providerMatch[2] };
  }

  return { mode: "match", modelId: model };
}

// Last resort: get ALL models including cooldown ones — better than 503
function getAllModelsIncludingCooldown(caps: RequestCapabilities): ModelRow[] {
  const db = getDb();
  const filters: string[] = ["m.context_length >= 32000"];
  if (caps.hasTools) filters.push("m.supports_tools = 1");
  if (caps.hasImages) filters.push("m.supports_vision = 1");
  const whereClause = filters.join(" AND ");

  const result = db.prepare(`
    SELECT m.id, m.provider, m.model_id, m.supports_tools, m.supports_vision, m.tier, m.context_length,
      COALESCE(b.avg_score, 0) as avg_score, COALESCE(b.avg_latency, 9999999) as avg_latency
    FROM models m
    LEFT JOIN (SELECT model_id, AVG(score) as avg_score, AVG(latency_ms) as avg_latency FROM benchmark_results GROUP BY model_id) b ON m.id = b.model_id
    WHERE ${whereClause}
    ORDER BY RANDOM()
    LIMIT 20
  `).all() as ModelRow[];

  return result;
}

function selectModelsByMode(
  mode: string,
  caps: RequestCapabilities
): ModelRow[] {
  const db = getDb();
  const now = new Date().toISOString();

  if (mode === "fast") {
    // fastest = lowest latency, still apply capability filters
    const filters: string[] = [
      "(h.status IS NULL OR h.status = 'available' OR h.status = 'error')",
      "(h.cooldown_until IS NULL OR h.cooldown_until < ?)",
    ];
    if (caps.hasTools) filters.push("m.supports_tools = 1");
    if (caps.hasImages) filters.push("m.supports_vision = 1");
    const whereClause = filters.join(" AND ");

    const rows = db
      .prepare(
        `
        SELECT
          m.id, m.provider, m.model_id, m.supports_tools, m.supports_vision, m.tier, m.context_length,
          COALESCE(b.avg_score, 0) as avg_score,
          COALESCE(b.avg_latency, 9999999) as avg_latency,
          h.status as health_status,
          h.cooldown_until
        FROM models m
        LEFT JOIN (
          SELECT model_id, AVG(score) as avg_score, AVG(latency_ms) as avg_latency
          FROM benchmark_results GROUP BY model_id
        ) b ON m.id = b.model_id
        LEFT JOIN (
          SELECT hl.model_id, hl.status, hl.cooldown_until
          FROM health_logs hl
          INNER JOIN (
            SELECT model_id, MAX(checked_at) as max_checked FROM health_logs GROUP BY model_id
          ) latest ON hl.model_id = latest.model_id AND hl.checked_at = latest.max_checked
        ) h ON m.id = h.model_id
        WHERE ${whereClause}
        ORDER BY avg_latency ASC, avg_score DESC
      `
      )
      .all(now) as ModelRow[];
    return rows;
  }

  if (mode === "tools") {
    return getAvailableModels({ ...caps, hasTools: true });
  }

  // auto / thai → no context filter, let provider handle 413
  return getAvailableModels(caps);
}

async function forwardToProvider(
  provider: string,
  actualModelId: string,
  body: Record<string, unknown>,
  stream: boolean,
  signal?: AbortSignal
): Promise<Response> {
  const url = PROVIDER_URLS[provider];
  if (!url) throw new Error(`Unknown provider: ${provider}`);

  const apiKey = getNextApiKey(provider);
  if (!apiKey) throw new Error(`No API key for provider: ${provider}`);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  // OpenRouter requires extra headers
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://bcproxy.ai";
    headers["X-Title"] = "BCProxyAI Gateway";
  }

  // Whitelist: only pass known OpenAI-compatible fields to upstream providers
  // Fixes: Google rejects unknown fields like "store" (OpenClaw memory feature)
  const ALLOWED_FIELDS = new Set([
    "messages", "temperature", "top_p", "max_tokens", "stream",
    "tools", "tool_choice", "response_format", "stop", "n", "seed", "user",
    "presence_penalty", "frequency_penalty", "logprobs", "top_logprobs",
    "parallel_tool_calls", "service_tier", "metadata",
  ]);
  const requestBody: Record<string, unknown> = { model: actualModelId };
  for (const [key, value] of Object.entries(body)) {
    if (ALLOWED_FIELDS.has(key)) {
      requestBody[key] = value;
    }
  }

  // Strip unsupported message fields (reasoning, refusal, etc.)
  // Groq/others reject messages with "reasoning" field from thinking models
  if (Array.isArray(requestBody.messages)) {
    for (const msg of requestBody.messages as Array<Record<string, unknown>>) {
      delete msg.reasoning;
      delete msg.refusal;
    }
  }

  // Google: sanitize conversation — strip tool_calls and tool role messages
  // Google's Gemini API requires strict ordering: user→assistant(tool_call)→tool→assistant
  // OpenClaw conversations have complex tool call patterns that don't match this
  if (provider === "google" && Array.isArray(requestBody.messages)) {
    const msgs = requestBody.messages as Array<Record<string, unknown>>;
    const sanitized: Array<Record<string, unknown>> = [];
    for (const msg of msgs) {
      // Skip tool role messages entirely
      if (msg.role === "tool") continue;
      // For assistant messages with tool_calls, convert to plain text
      if (msg.role === "assistant" && msg.tool_calls) {
        const textContent = (msg.content as string) || "";
        if (textContent) {
          sanitized.push({ role: "assistant", content: textContent });
        }
        continue;
      }
      // Pass through everything else
      sanitized.push(msg);
    }
    // Ensure conversation doesn't have consecutive same-role messages
    const merged: Array<Record<string, unknown>> = [];
    for (const msg of sanitized) {
      if (merged.length > 0 && merged[merged.length - 1].role === msg.role) {
        // Merge consecutive same-role messages
        const prev = merged[merged.length - 1];
        const prevContent = String(prev.content || "");
        const currContent = String(msg.content || "");
        prev.content = prevContent + "\n" + currContent;
      } else {
        merged.push({ ...msg });
      }
    }
    requestBody.messages = merged;
    // Keep tools/tool_choice so model can make proper function calls
  }

  // Compress messages if they are large (> 30K estimated tokens)
  if (Array.isArray(requestBody.messages)) {
    const compressed = compressMessages(requestBody.messages as { role: string; content: unknown }[]);
    if (compressed.compressed) {
      requestBody.messages = compressed.messages;
      console.log(`[Gateway] Compressed: saved ${compressed.savedChars} chars (~${Math.round(compressed.savedChars / 3)} tokens)`);
    }
  }

  // Ollama: set large context window via options.num_ctx
  if (provider === "ollama") {
    requestBody.options = { ...(requestBody.options as Record<string, unknown> ?? {}), num_ctx: 65536 };
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
    ...(signal ? { signal } : {}),
  });

  // On 429, mark this key as rate-limited and cooldown 5 minutes
  if (response.status === 429) {
    markKeyCooldown(provider, apiKey, 300000);
    // Return a new response with the body text so caller can read it
    const text = await response.text();
    return new Response(text, { status: 429, headers: response.headers });
  }

  return response;
}

function isRetryableStatus(status: number): boolean {
  return status === 413 || status === 429 || status >= 500;
}

// Pattern B+: Check if tool_calls are structurally broken (needs retry, not just repair)
function hasStructurallyBrokenToolCalls(json: Record<string, unknown>): { broken: boolean; reason: string } {
  const choices = json.choices as Array<Record<string, unknown>> | undefined;
  if (!choices?.[0]) return { broken: false, reason: "" };
  const msg = (choices[0] as Record<string, unknown>).message as Record<string, unknown> | undefined;
  if (!msg) return { broken: false, reason: "" };
  const toolCalls = msg.tool_calls;
  if (!toolCalls) return { broken: false, reason: "" };
  
  // tool_calls must be array
  if (!Array.isArray(toolCalls)) {
    return { broken: true, reason: "tool_calls is not an array" };
  }
  
  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i] as Record<string, unknown>;
    const fn = tc.function as Record<string, unknown> | undefined;
    
    // Must have function.name
    if (!fn?.name || typeof fn.name !== "string" || fn.name.trim() === "") {
      return { broken: true, reason: `tool_call[${i}] missing function.name` };
    }
    
    // Arguments too large → skip repair, needs retry
    const args = fn.arguments;
    if (typeof args === "string" && args.length > 100000) {
      return { broken: true, reason: `tool_call[${i}] arguments too large (${args.length} chars)` };
    }
    
    // Null/undefined arguments with valid name → broken
    if (args === null || args === undefined) {
      return { broken: true, reason: `tool_call[${i}] missing arguments` };
    }
  }
  
  return { broken: false, reason: "" };
}

// Pattern B+: Retry with a tools-capable model
interface RetryResult { response: Response; provider: string; modelId: string; }

async function retryWithToolsModel(
  body: Record<string, unknown>,
  caps: RequestCapabilities,
  excludeModelId: string,
  isStream: boolean
): Promise<RetryResult | null> {
  const candidates = getAvailableModels({ ...caps, hasTools: true });
  const filtered = candidates.filter(c => c.model_id !== excludeModelId);
  if (!filtered.length) {
    console.log("[ToolRepair] No tools-capable models available for retry");
    return null;
  }
  const pick = filtered[0];
  console.log(`[ToolRepair] Retry with ${pick.provider}/${pick.model_id}`);
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await forwardToProvider(pick.provider, pick.model_id, body, isStream, controller.signal);
    clearTimeout(timeoutId);
    return { response: resp, provider: pick.provider, modelId: pick.model_id };
  } catch (err) {
    clearTimeout(timeoutId);
    console.log(`[ToolRepair] Retry failed: ${String(err)}`);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;

    // Validate request body
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return NextResponse.json(
        { error: { message: "messages is required and must be a non-empty array", type: "invalid_request_error" } },
        { status: 400 }
      );
    }
    if (typeof body.model !== "string" && body.model !== undefined) {
      return NextResponse.json(
        { error: { message: "model must be a string", type: "invalid_request_error" } },
        { status: 400 }
      );
    }

    const modelField = (body.model as string) || "auto";
    const isStream = body.stream === true;
    const caps = detectRequestCapabilities(body);

    // Budget check — block at 95%
    const budget = checkBudget();
    if (!budget.ok) {
      return NextResponse.json(
        {
          error: {
            message: `Daily budget exceeded (${budget.percentUsed.toFixed(1)}% used). ลองใหม่พรุ่งนี้หรือเพิ่ม limit ผ่าน /api/budget`,
            type: "rate_limit_error",
            code: 429,
          },
        },
        { status: 429 }
      );
    }

    const parsed = parseModelField(modelField);

    // If budget >= 80%, prefer fast/cheap mode
    if (budget.preferCheap && parsed.mode === "auto") {
      parsed.mode = "fast" as typeof parsed.mode;
    }

    const estInputTokens = estimateTokens(body);

    // ---- Consensus mode: send to 3 providers, pick best answer ----
    if (parsed.mode === "consensus") {
      const userMsg = extractUserMessage(body);
      const consensusStart = Date.now();

      // Get top 3 models from different providers
      const allModels = getAvailableModels(caps);
      const picked: ModelRow[] = [];
      const usedProviders = new Set<string>();
      for (const m of allModels) {
        if (!usedProviders.has(m.provider) && picked.length < 3) {
          picked.push(m);
          usedProviders.add(m.provider);
        }
      }

      if (picked.length > 0) {
        // Force non-streaming for consensus (need full response to compare)
        const consensusBody = { ...body, stream: false };

        const results = await Promise.all(
          picked.map(async (m) => {
            const start = Date.now();
            try {
              const res = await forwardToProvider(m.provider, m.model_id, consensusBody, false);
              if (!res.ok) return null;
              const json = await res.json();
              const content = (json as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? "";
              return { model: m, content, latency: Date.now() - start, json };
            } catch {
              return null;
            }
          })
        );

        // Pick best: longest content, then lowest latency
        const valid = results.filter(
          (r): r is NonNullable<typeof r> => r != null && r.content.length > 0
        );

        if (valid.length > 0) {
          valid.sort((a, b) => {
            if (b.content.length !== a.content.length) return b.content.length - a.content.length;
            return a.latency - b.latency;
          });

          const best = valid[0];
          const totalLatency = Date.now() - consensusStart;

          // Track token usage for winning model
          const usage = (best.json as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
          if (usage) {
            trackTokenUsage(best.model.provider, best.model.model_id, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0);
          }

          logGateway(
            "bcproxy/consensus",
            best.model.model_id,
            best.model.provider,
            200,
            totalLatency,
            usage?.prompt_tokens ?? 0,
            usage?.completion_tokens ?? 0,
            null,
            userMsg,
            `[consensus: ${valid.map((v) => v.model.provider + "/" + v.model.model_id).join(", ")}] ${best.content.slice(0, 300)}`
          );

          const headers = new Headers();
          headers.set("Content-Type", "application/json");
          headers.set("X-BCProxy-Provider", best.model.provider);
          headers.set("X-BCProxy-Model", best.model.model_id);
          headers.set(
            "X-BCProxy-Consensus",
            valid.map((v) => `${v.model.provider}/${v.model.model_id}(${v.content.length}chars/${v.latency}ms)`).join(", ")
          );
          headers.set("Access-Control-Allow-Origin", "*");

          return new Response(JSON.stringify(best.json), { status: 200, headers });
        }
      }

      // Fallback: no consensus candidates or all failed → fall through to normal auto routing
      parsed.mode = "auto" as typeof parsed.mode;
    }

    // ---- Direct provider routing (openrouter/xxx, kilo/xxx, groq/xxx) ----
    if (parsed.mode === "direct") {
      const { provider, modelId } = parsed;
      const response = await forwardToProvider(provider!, modelId!, body, isStream);

      if (!response.ok && isRetryableStatus(response.status)) {
        const errText = await response.text();
        return NextResponse.json(
          { error: { message: errText, type: "provider_error", code: response.status } },
          { status: response.status }
        );
      }

      return buildProxiedResponse(response, provider!, modelId!, isStream, estInputTokens);
    }

    // ---- Match by model string ----
    if (parsed.mode === "match") {
      const db = getDb();
      const row = db
        .prepare(`SELECT id, provider, model_id FROM models WHERE id = ? OR model_id = ? LIMIT 1`)
        .get(parsed.modelId, parsed.modelId) as
        | { id: string; provider: string; model_id: string }
        | undefined;

      if (!row) {
        return NextResponse.json(
          {
            error: {
              message: `Model not found: ${parsed.modelId}`,
              type: "invalid_request_error",
              code: 404,
            },
          },
          { status: 404 }
        );
      }

      const response = await forwardToProvider(row.provider, row.model_id, body, isStream);
      if (!response.ok && isRetryableStatus(response.status)) {
        const errText = await response.text();
        return NextResponse.json(
          { error: { message: errText, type: "provider_error", code: response.status } },
          { status: response.status }
        );
      }
      return buildProxiedResponse(response, row.provider, row.model_id, isStream, estInputTokens);
    }

    // ---- Smart routing: auto / fast / tools / thai ----
    const candidates = selectModelsByMode(parsed.mode, caps);

    // ถ้าไม่มี candidate → ลองไม่ filter context → ลองรวม cooldown (สุ่มเลือก ดีกว่า 503)
    let finalCandidates = candidates;
    if (finalCandidates.length === 0) {
      finalCandidates = selectModelsByMode(parsed.mode, caps);
    }
    if (finalCandidates.length === 0) {
      // Last resort: สุ่มจาก ALL models (รวม cooldown) — ดีกว่าไม่ตอบ
      finalCandidates = getAllModelsIncludingCooldown(caps);
    }
    if (finalCandidates.length === 0) {
      return NextResponse.json(
        {
          error: {
            message: "ไม่มีโมเดลในระบบเลย — รอ Worker สแกนก่อน กดปุ่ม 'รันตอนนี้' บน Dashboard",
            type: "server_error",
            code: 503,
          },
        },
        { status: 503 }
      );
    }

    const MAX_RETRIES = 10; // try up to 10 models across different providers
    let lastError = "";
    const startTime = Date.now();
    const userMsg = extractUserMessage(body);
    const triedProviders = new Set<string>();

    // Weighted Load Balancing — all providers equal (including Ollama)
    const spreadCandidates: typeof finalCandidates = [];
    const byProvider: Record<string, typeof finalCandidates> = {};
    for (const c of finalCandidates) {
      (byProvider[c.provider] ??= []).push(c);
    }
    const providerOrder = Object.entries(byProvider)
      .map(([, models]) => {
        const avgLat = models.reduce((s, m) => s + (m.avg_latency ?? 9999999), 0) / models.length;
        const avgScore = models.reduce((s, m) => s + (m.avg_score ?? 0), 0) / models.length;
        return { models, weight: avgScore * 1000 - avgLat };
      })
      .sort((a, b) => b.weight - a.weight);
    // Round-robin across weighted providers
    let hasMore = true;
    let round = 0;
    const totalExpected = finalCandidates.length;
    while (hasMore && spreadCandidates.length < totalExpected) {
      hasMore = false;
      for (const { models: provModels } of providerOrder) {
        if (round < provModels.length) {
          spreadCandidates.push(provModels[round]);
          hasMore = true;
        }
      }
      round++;
    }


    for (let i = 0; i < Math.min(MAX_RETRIES, spreadCandidates.length); i++) {
      const candidate = spreadCandidates[i];
      const { provider, model_id: actualModelId, id: dbModelId } = candidate;
      triedProviders.add(provider);

      try {
        const response = await forwardToProvider(provider, actualModelId, body, isStream);

        if (response.ok) {
          const latency = Date.now() - startTime;
          // Model ทำงานได้ → clear cooldown
          try {
            const db = getDb();
            db.prepare("DELETE FROM health_logs WHERE model_id = ? AND cooldown_until > datetime('now')").run(dbModelId);
          } catch { /* silent */ }
          
          // Pattern B+: For non-streaming tool requests, check for structurally broken tool_calls
          if (!isStream && caps.hasTools) {
            const text = await response.text();
            try {
              const json = JSON.parse(text);
              const brokenCheck = hasStructurallyBrokenToolCalls(json);
              if (brokenCheck.broken) {
                console.log(`[ToolRepair] Structurally broken from ${provider}/${actualModelId}: ${brokenCheck.reason}`);
                const retry = await retryWithToolsModel(body, caps, actualModelId, isStream);
                if (retry?.response.ok) {
                  const proxied = await buildProxiedResponse(retry.response, retry.provider, retry.modelId, isStream, estInputTokens);
                  logGateway(modelField, retry.modelId, retry.provider, 200, Date.now() - startTime, 0, 0, null, userMsg, "[tool_retry]");
                  return proxied;
                }
                // Retry failed → continue with original (buildProxiedResponse will try jsonrepair)
                console.log("[ToolRepair] Retry failed, using original response");
              }
            } catch { /* not JSON — let buildProxiedResponse handle */ }
            
            // Wrap text back into Response for buildProxiedResponse
            const wrappedResponse = new Response(text, { status: 200, headers: response.headers });
            const proxied = await buildProxiedResponse(wrappedResponse, provider, actualModelId, isStream, estInputTokens);
            try {
              const cloned = proxied.clone();
              const pjson = await cloned.json();
              const assistantContent = pjson.choices?.[0]?.message?.content?.slice(0, 500) ?? null;
              const usage = pjson.usage;
              logGateway(modelField, actualModelId, provider, 200, latency,
                usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0,
                null, userMsg, assistantContent);
            } catch {
              logGateway(modelField, actualModelId, provider, 200, latency, 0, 0, null, userMsg, null);
            }
            return proxied;
          }
          
          const proxied = await buildProxiedResponse(response, provider, actualModelId, isStream, estInputTokens);
          // Log with assistant response (extract from non-stream)
          if (!isStream) {
            try {
              const cloned = proxied.clone();
              const json = await cloned.json();
              const assistantContent = json.choices?.[0]?.message?.content?.slice(0, 500) ?? null;
              const usage = json.usage;
              logGateway(modelField, actualModelId, provider, 200, latency,
                usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0,
                null, userMsg, assistantContent);
            } catch {
              logGateway(modelField, actualModelId, provider, 200, latency, 0, 0, null, userMsg, null);
            }
          } else {
            logGateway(modelField, actualModelId, provider, 200, latency, 0, 0, null, userMsg, "[stream]");
          }
          return proxied;
        }

        // Non-200: cooldown for cloud providers only (Ollama = local, never cooldown)
        const errText = await response.text().catch(() => "");
        console.error(`[Gateway] ${provider}/${actualModelId} HTTP ${response.status}: ${errText.slice(0, 500)}`);
        lastError = `${provider}/${actualModelId}: HTTP ${response.status}`;
        const st = response.status;
        if (provider !== "ollama" && (st === 429 || st === 413 || st === 422 || st >= 500 || st === 401 || st === 403)) {
          logCooldown(dbModelId, `HTTP ${st}: ${errText}`, st);
        }
        // Always retry next model regardless
        continue;
      } catch (err) {
        lastError = `${provider}/${actualModelId}: ${String(err)}`;
        logCooldown(dbModelId, lastError);
        continue;
      }
    }

    // All retries exhausted
    const latency = Date.now() - startTime;
    logGateway(modelField, null, null, 503, latency, 0, 0, lastError.slice(0, 300), userMsg, null);
    return NextResponse.json(
      {
        error: {
          message: `ลองแล้ว ${Math.min(MAX_RETRIES, spreadCandidates.length)} โมเดล (${triedProviders.size} providers) ไม่สำเร็จ: ${lastError}`,
          type: "server_error",
          code: 503,
        },
      },
      { status: 503 }
    );
  } catch (err) {
    console.error("[Gateway] Unexpected error:", err);
    return NextResponse.json(
      {
        error: {
          message: String(err),
          type: "server_error",
          code: 500,
        },
      },
      { status: 500 }
    );
  }
}

async function buildProxiedResponse(
  upstream: Response,
  provider: string,
  modelId: string,
  stream: boolean,
  estimatedInputTokens = 0
): Promise<Response> {
  const headers = new Headers();
  headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/json");
  headers.set("X-BCProxy-Provider", provider);
  headers.set("X-BCProxy-Model", modelId);

  // Pass through CORS headers if needed
  headers.set("Access-Control-Allow-Origin", "*");

  if (stream && upstream.body) {
    // Stream SSE — track estimated tokens from content length
    const reader = upstream.body.getReader();
    let totalBytes = 0;
    const passthrough = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          // Estimate output tokens from streamed bytes (~3 chars/token)
          const estOutputTokens = Math.ceil(totalBytes / 3);
          trackTokenUsage(provider, modelId, estimatedInputTokens, estOutputTokens);
          controller.close();
          return;
        }
        totalBytes += value.byteLength;
        controller.enqueue(value);
      },
    });
    return new Response(passthrough, {
      status: upstream.status,
      headers,
    });
  }

  // Non-streaming: read body, fix reasoning→content, track tokens, return
  try {
    const text = await upstream.text();
    const json = JSON.parse(text);

    // Fix: some models (Ollama/gemma4) put answer in reasoning field instead of content
    if (json.choices) {
      for (const choice of json.choices) {
        const msg = choice.message;
        if (msg && (!msg.content || msg.content === "") && msg.reasoning) {
          // Extract actual answer from reasoning (last meaningful line)
          msg.content = msg.reasoning;
        }
      }
    }

    // Fix tool call parameters: validate, repair with jsonrepair, coerce numbers
    if (json.choices) {
      for (const choice of json.choices) {
        const toolCalls = choice.message?.tool_calls;
        if (Array.isArray(toolCalls)) {
          for (const tc of toolCalls) {
            // Fix missing id/type
            if (!tc.id) tc.id = uuidv4();
            if (!tc.type) tc.type = "function";
            
            // Fix arguments
            if (tc.function?.arguments) {
              let argsStr = typeof tc.function.arguments === "object" 
                ? JSON.stringify(tc.function.arguments) 
                : String(tc.function.arguments);
              
              // Strip markdown fences if present
              argsStr = argsStr.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "");
              
              try {
                const args = JSON.parse(argsStr);
                // Auto-fix: convert string numbers to actual numbers
                for (const [key, val] of Object.entries(args)) {
                  if (typeof val === "string" && /^\d+$/.test(val)) {
                    args[key] = Number(val);
                  }
                }
                tc.function.arguments = JSON.stringify(args);
              } catch {
                // JSON.parse failed → try jsonrepair
                try {
                  const repaired = jsonrepair(argsStr);
                  JSON.parse(repaired); // verify it's valid
                  tc.function.arguments = repaired;
                  console.log(`[ToolRepair] Repaired tool_call arguments for ${tc.function?.name}`);
                } catch {
                  // jsonrepair also failed — keep original, client will handle
                  console.log(`[ToolRepair] Could not repair arguments for ${tc.function?.name}`);
                }
              }
            }
          }
        }
      }
    }

    // Track token usage
    const usage = json.usage;
    if (usage) {
      trackTokenUsage(provider, modelId, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0);
    } else {
      const estOutput = Math.ceil(text.length / 3);
      trackTokenUsage(provider, modelId, estimatedInputTokens, estOutput);
    }

    return new Response(JSON.stringify(json), {
      status: upstream.status,
      headers,
    });
  } catch {
    // Fallback: pass through raw body
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  }
}

// Handle OPTIONS for CORS preflight
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
