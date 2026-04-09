import { NextRequest } from "next/server";
import { getSqlClient } from "@/lib/db/schema";
import { getNextApiKey, markKeyCooldown } from "@/lib/api-keys";
import { PROVIDER_URLS } from "@/lib/providers";
import { clearCache } from "@/lib/cache";
import { compressMessages } from "@/lib/prompt-compress";
import { openAIError, ensureChatCompletionFields } from "@/lib/openai-compat";
import { autoDetectComplaint } from "@/lib/auto-complaint";
import { getReputationScore } from "@/lib/worker/complaint";
import { detectPromptCategory, recordRoutingResult, getBestModelsForCategory, getBestModelsByBenchmarkCategory, emitEvent, getRealAvgLatency } from "@/lib/routing-learn";
import { getRedis } from "@/lib/redis";
import { checkRateLimit } from "@/lib/rate-limit";
import { getCachedResponse, setCachedResponse } from "@/lib/response-cache";
import { recordBattleEvent, outcomeFromLatency } from "@/lib/battle-score";
import { hasTpmHeadroom, recordTokenConsumption } from "@/lib/tpm-tracker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Budget check: returns { ok, percentUsed }
async function checkBudget(): Promise<{ ok: boolean; preferCheap: boolean; percentUsed: number }> {
  try {
    const sql = getSqlClient();
    const configRows = await sql<{ value: string }[]>`
      SELECT value FROM budget_config WHERE key = 'daily_token_limit'
    `;
    const dailyLimit = configRows.length > 0 ? Number(configRows[0].value) : 1000000;

    const today = new Date().toISOString().slice(0, 10);
    const usageRows = await sql<{ total: number }[]>`
      SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS total
      FROM token_usage WHERE created_at >= ${today + 'T00:00:00'}::timestamptz
    `;
    const total = Number(usageRows[0]?.total ?? 0);

    const percentUsed = dailyLimit > 0 ? (total / dailyLimit) * 100 : 0;
    return { ok: percentUsed < 95, preferCheap: percentUsed >= 80, percentUsed };
  } catch {
    return { ok: true, preferCheap: false, percentUsed: 0 };
  }
}

async function trackTokenUsage(provider: string, modelId: string, inputTokens: number, outputTokens: number) {
  try {
    const sql = getSqlClient();
    await sql`
      INSERT INTO token_usage (provider, model_id, input_tokens, output_tokens, estimated_cost_usd)
      VALUES (${provider}, ${modelId}, ${inputTokens}, ${outputTokens}, 0)
    `;
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
  context_length: number;
  avg_score: number | null;
  avg_latency: number | null;
  health_status: string | null;
  cooldown_until: string | null;
}

// ─── Redis-backed Provider Cooldown (in-memory fallback) ───
const _memCooldowns = new Map<string, { until: number; reason: string }>();
const _memFailures = new Map<string, { count: number; firstAt: number; totalSeen: number }>();
const FAILURE_STREAK_THRESHOLD = 10;
const FAILURE_STREAK_WINDOW_MS = 3 * 60 * 1000;
const STREAK_COOLDOWN_MS = 30 * 60 * 1000;

// Track every attempt (success or failure) for sample-size guard
async function recordProviderAttempt(provider: string): Promise<void> {
  try {
    const redis = getRedis();
    const key = `fs:provider:${provider}`;
    const raw = await redis.get(key);
    if (!raw) return; // no failure window open yet — nothing to update
    const entry = JSON.parse(raw) as { count: number; firstAt: number; totalSeen?: number };
    entry.totalSeen = (entry.totalSeen ?? 0) + 1;
    await redis.set(key, JSON.stringify(entry), "PX", FAILURE_STREAK_WINDOW_MS);
  } catch {
    // in-memory fallback: if there's an entry, bump totalSeen
    const entry = _memFailures.get(provider);
    if (entry) entry.totalSeen = (entry.totalSeen ?? 0) + 1;
  }
}

async function isProviderCooledDownMem(provider: string): Promise<boolean> {
  // Try Redis first
  try {
    const redis = getRedis();
    const val = await redis.get(`cd:provider:${provider}`);
    if (val !== null) return true;
  } catch { /* fall through */ }
  // Fallback: in-memory
  const cd = _memCooldowns.get(provider);
  if (!cd) return false;
  if (Date.now() > cd.until) { _memCooldowns.delete(provider); return false; }
  return true;
}

async function setProviderCooldownMem(provider: string, ms: number, reason: string): Promise<void> {
  console.log(`[COOLDOWN] ${provider} → ${Math.round(ms / 60000)}min | ${reason}`);
  try {
    const redis = getRedis();
    await redis.set(`cd:provider:${provider}`, reason, "PX", ms);
  } catch {
    // Fallback: in-memory
    _memCooldowns.set(provider, { until: Date.now() + ms, reason });
  }
}

async function recordProviderFailureMem(provider: string): Promise<void> {
  try {
    const redis = getRedis();
    const key = `fs:provider:${provider}`;
    const raw = await redis.get(key);
    const now = Date.now();
    const entry = raw ? JSON.parse(raw) as { count: number; firstAt: number; totalSeen: number } : null;
    if (!entry || now - entry.firstAt > FAILURE_STREAK_WINDOW_MS) {
      await redis.set(key, JSON.stringify({ count: 1, firstAt: now, totalSeen: 1 }), "PX", FAILURE_STREAK_WINDOW_MS);
      return;
    }
    entry.count += 1;
    entry.totalSeen = (entry.totalSeen ?? 0) + 1;
    // Require minimum sample size: only trigger if count>=10 AND totalSeen>=20
    if (entry.count >= FAILURE_STREAK_THRESHOLD && entry.totalSeen >= 20) {
      await setProviderCooldownMem(provider, STREAK_COOLDOWN_MS, `failure streak: ${entry.count}/${entry.totalSeen} in ${Math.round((now - entry.firstAt) / 1000)}s`);
      await redis.del(key);
    } else {
      await redis.set(key, JSON.stringify(entry), "PX", FAILURE_STREAK_WINDOW_MS);
    }
  } catch {
    // Fallback: in-memory
    const now = Date.now();
    const entry = _memFailures.get(provider);
    if (!entry || now - entry.firstAt > FAILURE_STREAK_WINDOW_MS) {
      _memFailures.set(provider, { count: 1, firstAt: now, totalSeen: 1 });
      return;
    }
    entry.count += 1;
    entry.totalSeen = (entry.totalSeen ?? 0) + 1;
    if (entry.count >= FAILURE_STREAK_THRESHOLD && entry.totalSeen >= 20) {
      await setProviderCooldownMem(provider, STREAK_COOLDOWN_MS, `failure streak: ${entry.count}/${entry.totalSeen}`);
      _memFailures.delete(provider);
    }
  }
}

async function recordProviderSuccessMem(provider: string): Promise<void> {
  try {
    const redis = getRedis();
    await redis.del(`fs:provider:${provider}`);
    // Circuit breaker: record success in rolling window
    const succKey = `cb:succ:${provider}`;
    const cur = await redis.get(succKey);
    const newVal = (Number(cur ?? 0) + 1).toString();
    await redis.set(succKey, newVal, "EX", 30);
  } catch { /* ignore */ }
  _memFailures.delete(provider);
}

// P1-3: Circuit breaker — check if provider circuit is open
async function isCircuitOpen(provider: string): Promise<boolean> {
  try {
    const redis = getRedis();
    const cbKey = `cb:open:${provider}`;
    const val = await redis.get(cbKey);
    if (val === null) return false;
    if (val === "half-open") return false; // allow probe
    // val === "open" — check if we're in the last 30s of the cooldown
    const ttl = await redis.ttl(cbKey);
    if (ttl > 0 && ttl <= 30) {
      // Promote to half-open so the next request becomes a probe
      await redis.set(cbKey, "half-open", "EX", ttl);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// P1-3: Record result of a half-open probe attempt
async function recordCircuitProbeResult(provider: string, success: boolean): Promise<void> {
  try {
    const redis = getRedis();
    const cbKey = `cb:open:${provider}`;
    const state = await redis.get(cbKey);
    if (state !== "half-open") return; // not currently probing
    if (success) {
      // Probe succeeded → fully close circuit + reset counters
      await redis.del(cbKey);
      await redis.del(`cb:fail:${provider}`);
      await redis.del(`cb:succ:${provider}`);
      console.log(`[CIRCUIT-CLOSE] ${provider} — half-open probe succeeded`);
    } else {
      // Probe failed → re-open for 4 minutes (escalating)
      await redis.set(cbKey, "open", "EX", 240);
      console.log(`[CIRCUIT-REOPEN] ${provider} — half-open probe failed → 4min`);
    }
  } catch { /* ignore */ }
}

// P1-3: Record provider failure for circuit breaker rolling window
async function recordCircuitFailure(provider: string): Promise<void> {
  try {
    const redis = getRedis();
    const failKey = `cb:fail:${provider}`;
    const succKey = `cb:succ:${provider}`;
    const cur = await redis.get(failKey);
    const newVal = (Number(cur ?? 0) + 1).toString();
    await redis.set(failKey, newVal, "EX", 30);

    const fails = Number(newVal);
    const succs = Number((await redis.get(succKey)) ?? 0);
    const total = fails + succs;
    if (total >= 5) {
      const successRate = succs / total;
      if (successRate < 0.3) {
        // Open circuit for 2 minutes
        const cbKey = `cb:open:${provider}`;
        await redis.set(cbKey, "open", "EX", 120);
        console.log(`[CIRCUIT-OPEN] ${provider} — success rate ${(successRate * 100).toFixed(0)}% < 30% → circuit open 2min`);
      }
    }
  } catch { /* ignore */ }
}

interface RequestCapabilities {
  hasTools: boolean;
  hasImages: boolean;
  needsJsonSchema: boolean;
}

function detectRequestCapabilities(body: Record<string, unknown>): RequestCapabilities {
  const hasTools = Array.isArray(body.tools) && (body.tools as unknown[]).length > 0;

  const messages = (body.messages as Array<{ role: string; content: unknown }>) || [];
  let hasImages = false;
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const part of msg.content as Array<{ type: string }>) {
        if (part.type === "image_url") { hasImages = true; break; }
      }
    }
    if (hasImages) break;
  }

  const responseFormat = body.response_format as { type?: string; json_schema?: unknown } | undefined;
  const needsJsonSchema = responseFormat?.type === "json_schema" && responseFormat?.json_schema != null;

  return { hasTools, hasImages, needsJsonSchema };
}

function estimateTokens(body: Record<string, unknown>): number {
  const str = JSON.stringify(body.messages ?? []);
  return Math.ceil(str.length / 3);
}

const VISION_PRIORITY_PROVIDERS = ["google", "groq", "ollama", "github"];

// P2: OpenRouter free-tier models that claim supports_tools=1 in DB but 404 at runtime
const KNOWN_BROKEN_TOOL_MODELS = new Set([
  "openrouter:google/gemma-3n-e2b-it:free",
  "openrouter:google/gemma-3n-e4b-it:free",
]);

async function getAvailableModels(caps: RequestCapabilities, benchmarkCategory?: string): Promise<ModelRow[]> {
  const sql = getSqlClient();

  const visionFilter = caps.hasImages ? `AND m.supports_vision = 1` : "";
  const toolsFilter = caps.hasTools ? `AND m.supports_tools = 1` : "";
  const visionBoost = caps.hasImages
    ? `, CASE WHEN m.provider IN ('google','groq','ollama','github') THEN 0 ELSE 1 END as vision_priority`
    : "";
  const visionOrder = caps.hasImages ? "vision_priority ASC," : "";
  const toolsBoost = caps.hasTools
    ? "CASE WHEN m.context_length >= 128000 THEN 0 WHEN m.context_length >= 32000 THEN 1 ELSE 2 END ASC,"
    : "";

  // Use raw SQL for this complex query — includes real production latency from routing_stats
  const rows = await sql.unsafe(`
    SELECT
      m.id, m.provider, m.model_id, m.supports_tools, m.supports_vision, m.tier, m.context_length,
      ${benchmarkCategory
        ? `COALESCE(bcat.avg_score, ball.avg_score_all, 0) as avg_score,
           COALESCE(rs.avg_lat_real, bcat.avg_latency, ball.avg_latency_all, 9999999) as avg_latency`
        : `COALESCE(ball.avg_score_all, 0) as avg_score,
           COALESCE(rs.avg_lat_real, ball.avg_latency_all, 9999999) as avg_latency`
      },
      h.status as health_status,
      h.cooldown_until
      ${visionBoost}
    FROM models m
    ${benchmarkCategory
      ? `LEFT JOIN (
          SELECT model_id, AVG(score) as avg_score, AVG(latency_ms) as avg_latency
          FROM benchmark_results WHERE category = '${benchmarkCategory.replace(/'/g, "''")}'
          GROUP BY model_id
        ) bcat ON m.id = bcat.model_id`
      : ""
    }
    LEFT JOIN (
      SELECT model_id, AVG(score) as avg_score_all, AVG(latency_ms) as avg_latency_all
      FROM benchmark_results GROUP BY model_id
    ) ball ON m.id = ball.model_id
    LEFT JOIN (
      SELECT model_id, AVG(latency_ms)::float AS avg_lat_real
      FROM routing_stats
      WHERE created_at >= now() - interval '24 hours'
      GROUP BY model_id
      HAVING COUNT(*) >= 3
    ) rs ON m.id = rs.model_id
    LEFT JOIN (
      SELECT hl.model_id, hl.status, hl.cooldown_until
      FROM health_logs hl
      INNER JOIN (
        SELECT model_id, MAX(id) as max_id FROM health_logs GROUP BY model_id
      ) latest ON hl.model_id = latest.model_id AND hl.id = latest.max_id
    ) h ON m.id = h.model_id
    WHERE (h.cooldown_until IS NULL OR h.cooldown_until < now())
      AND COALESCE(m.supports_embedding, 0) != 1
      AND COALESCE(m.supports_audio_output, 0) != 1
      AND COALESCE(m.supports_image_gen, 0) != 1
      ${visionFilter}
      ${toolsFilter}
    ORDER BY ${toolsBoost} ${visionOrder}
      ${caps.needsJsonSchema ? "CASE WHEN m.tier = 'large' THEN 0 ELSE 1 END ASC," : ""}
      CASE WHEN ${benchmarkCategory ? "COALESCE(bcat.avg_score, ball.avg_score_all, 0)" : "COALESCE(ball.avg_score_all, 0)"} > 0 THEN 0 ELSE 1 END ASC,
      ${benchmarkCategory ? "COALESCE(bcat.avg_score, ball.avg_score_all, 0)" : "COALESCE(ball.avg_score_all, 0)"} DESC,
      m.context_length DESC,
      COALESCE(rs.avg_lat_real, ${benchmarkCategory ? "COALESCE(bcat.avg_latency, ball.avg_latency_all, 9999999)" : "COALESCE(ball.avg_latency_all, 9999999)"}) ASC
  `) as ModelRow[];

  // Apply Ollama slowness penalty: push Ollama to end if any cloud provider is available
  const cloudRows = rows.filter(r => r.provider !== "ollama");
  const ollamaRows = rows.filter(r => r.provider === "ollama");
  let reorderedRows = cloudRows.length > 0 ? [...cloudRows, ...ollamaRows] : rows;

  // Improvement D: fast-stream provider boost — subtract 500ms from effective latency for sorting
  const FAST_STREAM_PROVIDERS = new Set(["groq", "cerebras", "together"]);
  if (reorderedRows.length > 1) {
    reorderedRows = [...reorderedRows].sort((a, b) => {
      const adjA = (a.avg_latency ?? 9999999) - (FAST_STREAM_PROVIDERS.has(a.provider) ? 500 : 0);
      const adjB = (b.avg_latency ?? 9999999) - (FAST_STREAM_PROVIDERS.has(b.provider) ? 500 : 0);
      // Keep Ollama at end regardless
      if (a.provider === "ollama" && b.provider !== "ollama") return 1;
      if (b.provider === "ollama" && a.provider !== "ollama") return -1;
      return adjA - adjB;
    });
  }

  if (process.env.LOG_LEVEL === "debug") {
    const providerCount: Record<string, number> = {};
    for (const r of reorderedRows) providerCount[r.provider] = (providerCount[r.provider] || 0) + 1;
    console.log(`[DEBUG] mode=auto candidates=${reorderedRows.length} providers=${JSON.stringify(providerCount)}`);
    if (reorderedRows.length > 0) {
      const top3 = reorderedRows.slice(0, 3).map(r => `${r.provider}/${r.model_id}(${r.avg_latency}ms)`);
      console.log(`[DEBUG] after boost: candidates=${reorderedRows.length} top3=[${top3}]`);
    }
  }

  return reorderedRows;
}

async function logGateway(
  requestModel: string, resolvedModel: string | null, provider: string | null,
  status: number, latencyMs: number, inputTokens: number, outputTokens: number,
  error: string | null, userMessage: string | null, assistantMessage: string | null
) {
  try {
    const sql = getSqlClient();
    await sql`
      INSERT INTO gateway_logs (request_model, resolved_model, provider, status, latency_ms,
        input_tokens, output_tokens, error, user_message, assistant_message)
      VALUES (
        ${requestModel}, ${resolvedModel}, ${provider}, ${status}, ${latencyMs},
        ${inputTokens}, ${outputTokens}, ${error},
        ${userMessage?.slice(0, 500) ?? null}, ${assistantMessage?.slice(0, 500) ?? null}
      )
    `;
  } catch {
    // non-critical
  }
}

function extractUserMessage(body: Record<string, unknown>): string | null {
  const messages = body.messages as Array<{ role: string; content: unknown }> | undefined;
  if (!messages || messages.length === 0) return null;
  const last = messages[messages.length - 1];
  if (typeof last.content === "string") return last.content.slice(0, 500);
  if (Array.isArray(last.content)) {
    return (last.content as Array<{ type: string; text?: string }>)
      .filter((p) => p.type === "text" && p.text).map((p) => p.text).join("").slice(0, 500) || null;
  }
  return JSON.stringify(last.content).slice(0, 500);
}

async function logCooldown(modelId: string, errorMsg: string, httpStatus = 0, overrideMinutes?: number) {
  try {
    const sql = getSqlClient();
    let cooldownMs: number;
    if (overrideMinutes !== undefined) {
      cooldownMs = overrideMinutes * 60 * 1000;
    } else if (httpStatus === 402) {
      cooldownMs = 24 * 60 * 60 * 1000;
    } else if (httpStatus === 429) {
      cooldownMs = 2 * 60 * 1000;
    } else if (httpStatus === 410) {
      cooldownMs = 24 * 60 * 60 * 1000;
    } else if (httpStatus === 401 || httpStatus === 403) {
      cooldownMs = 60 * 60 * 1000;
    } else if (httpStatus >= 500) {
      cooldownMs = 5 * 60 * 1000;
    } else {
      cooldownMs = 1 * 60 * 1000;
    }
    const cooldownUntil = new Date(Date.now() + cooldownMs).toISOString();
    await sql`
      INSERT INTO health_logs (model_id, status, error, cooldown_until, checked_at)
      VALUES (${modelId}, 'available', ${errorMsg}, ${cooldownUntil}, now())
    `;
    clearCache("models:");
    clearCache("allmodels:");
  } catch {
    // non-critical
  }
}

async function cooldownProvider(provider: string, httpStatus: number, errorMsg: string): Promise<void> {
  let cooldownMs: number;
  if (httpStatus === 402) cooldownMs = 24 * 60 * 60 * 1000;
  else if (httpStatus === 429) cooldownMs = 5 * 60 * 1000;
  else if (httpStatus === 401 || httpStatus === 403) cooldownMs = 60 * 60 * 1000;
  else cooldownMs = 5 * 60 * 1000;
  await setProviderCooldownMem(provider, cooldownMs, `HTTP ${httpStatus}: ${errorMsg}`);
}

function parseModelField(model: string): {
  mode: "auto" | "fast" | "tools" | "thai" | "consensus" | "direct" | "match";
  provider?: string;
  modelId?: string;
} {
  if (!model || model === "auto" || model === "bcproxy/auto") return { mode: "auto" };
  if (model === "bcproxy/fast") return { mode: "fast" };
  if (model === "bcproxy/tools") return { mode: "tools" };
  if (model === "bcproxy/thai") return { mode: "thai" };
  if (model === "bcproxy/consensus") return { mode: "consensus" };

  const providerMatch = model.match(/^(openrouter|kilo|google|groq|cerebras|sambanova|mistral|ollama|github|fireworks|cohere|cloudflare|huggingface)\/(.+)$/);
  if (providerMatch) return { mode: "direct", provider: providerMatch[1], modelId: providerMatch[2] };

  return { mode: "match", modelId: model };
}

async function getAllModelsIncludingCooldown(caps: RequestCapabilities): Promise<ModelRow[]> {
  const sql = getSqlClient();
  const visionFilter = caps.hasImages ? "AND m.supports_vision = 1" : "";
  const orderClause = caps.hasImages
    ? "CASE WHEN m.provider IN ('google','groq','ollama') THEN 0 ELSE 1 END ASC, RANDOM()"
    : "RANDOM()";

  return await sql.unsafe(`
    SELECT m.id, m.provider, m.model_id, m.supports_tools, m.supports_vision, m.tier, m.context_length,
      COALESCE(b.avg_score, 0) as avg_score, COALESCE(b.avg_latency, 9999999) as avg_latency
    FROM models m
    LEFT JOIN (SELECT model_id, AVG(score) as avg_score, AVG(latency_ms) as avg_latency FROM benchmark_results GROUP BY model_id) b ON m.id = b.model_id
    WHERE m.context_length >= 32000
      AND COALESCE(m.supports_embedding, 0) != 1
      AND COALESCE(m.supports_audio_output, 0) != 1
      AND COALESCE(m.supports_image_gen, 0) != 1
      ${visionFilter}
    ORDER BY ${orderClause}
    LIMIT 20
  `) as ModelRow[];
}

async function selectModelsByMode(
  mode: string,
  caps: RequestCapabilities,
  benchmarkCategory?: string
): Promise<ModelRow[]> {
  const sql = getSqlClient();

  if (mode === "fast") {
    const visionFilter = caps.hasImages ? "AND m.supports_vision = 1" : "";
    const fastRows = await sql.unsafe(`
      SELECT
        m.id, m.provider, m.model_id, m.supports_tools, m.supports_vision, m.tier, m.context_length,
        COALESCE(b.avg_score, 0) as avg_score,
        COALESCE(rs.avg_lat_real, b.avg_latency, 9999999) as avg_latency,
        h.status as health_status,
        h.cooldown_until
      FROM models m
      LEFT JOIN (
        SELECT model_id, AVG(score) as avg_score, AVG(latency_ms) as avg_latency
        FROM benchmark_results GROUP BY model_id
      ) b ON m.id = b.model_id
      LEFT JOIN (
        SELECT model_id, AVG(latency_ms)::float AS avg_lat_real
        FROM routing_stats
        WHERE created_at >= now() - interval '24 hours'
        GROUP BY model_id
        HAVING COUNT(*) >= 3
      ) rs ON m.id = rs.model_id
      LEFT JOIN (
        SELECT hl.model_id, hl.status, hl.cooldown_until
        FROM health_logs hl
        INNER JOIN (
          SELECT model_id, MAX(checked_at) as max_checked FROM health_logs GROUP BY model_id
        ) latest ON hl.model_id = latest.model_id AND hl.checked_at = latest.max_checked
      ) h ON m.id = h.model_id
      WHERE (h.cooldown_until IS NULL OR h.cooldown_until < now())
        AND COALESCE(m.supports_embedding, 0) != 1
        AND COALESCE(m.supports_audio_output, 0) != 1
        AND COALESCE(m.supports_image_gen, 0) != 1
        ${visionFilter}
      ORDER BY
        CASE WHEN m.provider = 'ollama' THEN 1 ELSE 0 END ASC,
        COALESCE(rs.avg_lat_real, b.avg_latency, 9999999) ASC,
        avg_score DESC
    `) as ModelRow[];
    return fastRows;
  }

  if (mode === "tools") {
    return getAvailableModels({ ...caps, hasTools: true }, benchmarkCategory);
  }

  return getAvailableModels(caps, benchmarkCategory);
}

async function forwardToProvider(
  provider: string,
  actualModelId: string,
  body: Record<string, unknown>,
  stream: boolean,
  externalSignal?: AbortSignal
): Promise<Response> {
  const url = PROVIDER_URLS[provider];
  if (!url) throw new Error(`Unknown provider: ${provider}`);

  const apiKey = getNextApiKey(provider);
  if (!apiKey) throw new Error(`No API key for provider: ${provider}`);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://bcproxy.ai";
    headers["X-Title"] = "BCProxyAI Gateway";
  }

  const requestBody: Record<string, unknown> = { ...body, model: actualModelId };

  delete requestBody.store;
  delete requestBody.stream_options;
  if (requestBody.max_completion_tokens && !requestBody.max_tokens) {
    requestBody.max_tokens = requestBody.max_completion_tokens;
    delete requestBody.max_completion_tokens;
  }

  if (Array.isArray(requestBody.messages)) {
    for (const msg of requestBody.messages as Array<Record<string, unknown>>) {
      if (msg.reasoning !== undefined) delete msg.reasoning;
      if (msg.reasoning_content !== undefined) delete msg.reasoning_content;

      if (Array.isArray(msg.tool_calls)) {
        const tcs = msg.tool_calls as Array<Record<string, unknown>>;
        if (tcs.length === 0) {
          delete msg.tool_calls;
        } else {
          for (const tc of tcs) {
            if (tc.type !== "function") tc.type = "function";
          }
          if (msg.content === "") msg.content = null;
        }
      }

      if (msg.role === "assistant" && !msg.tool_calls) {
        if (msg.content === null || msg.content === undefined || msg.content === "") {
          msg.content = " ";
        }
      }
    }
  }

  if (provider === "mistral" && Array.isArray(requestBody.messages)) {
    const idMap = new Map<string, string>();
    let counter = 0;
    const msgs = requestBody.messages as Array<{ role: string; tool_calls?: Array<{ id: string }>; tool_call_id?: string }>;
    for (const msg of msgs) {
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (tc.id && (tc.id.length !== 9 || !/^[a-zA-Z0-9]+$/.test(tc.id))) {
            if (!idMap.has(tc.id)) idMap.set(tc.id, `tc${String(counter++).padStart(7, "0")}`);
            tc.id = idMap.get(tc.id)!;
          }
        }
      }
      if (msg.role === "tool" && msg.tool_call_id) {
        if (idMap.has(msg.tool_call_id)) {
          msg.tool_call_id = idMap.get(msg.tool_call_id)!;
        } else if (msg.tool_call_id.length !== 9 || !/^[a-zA-Z0-9]+$/.test(msg.tool_call_id)) {
          const newId = `tc${String(counter++).padStart(7, "0")}`;
          idMap.set(msg.tool_call_id, newId);
          msg.tool_call_id = newId;
        }
      }
    }
    if (idMap.size > 0) console.log(`[FWD] Fixed ${idMap.size} tool_call_ids for Mistral compatibility`);
    if (requestBody.max_tokens && (requestBody.max_tokens as number) > 16384) requestBody.max_tokens = 16384;
  }

  if (provider === "ollama" && Array.isArray(requestBody.messages)) {
    const msgs = requestBody.messages as Array<{ role: string; content: unknown }>;
    for (const msg of msgs) {
      if (Array.isArray(msg.content)) {
        for (const part of msg.content as Array<{ type: string; image_url?: { url?: string } }>) {
          if (part.type === "image_url" && part.image_url?.url && !part.image_url.url.startsWith("data:")) {
            try {
              const imgRes = await fetch(part.image_url.url, { signal: AbortSignal.timeout(10000) });
              if (imgRes.ok) {
                const buf = Buffer.from(await imgRes.arrayBuffer());
                const mime = imgRes.headers.get("content-type") || "image/jpeg";
                part.image_url.url = `data:${mime};base64,${buf.toString("base64")}`;
              }
            } catch { /* keep original URL */ }
          }
        }
      }
    }
  }

  if (Array.isArray(requestBody.messages)) {
    const compressed = compressMessages(requestBody.messages as { role: string; content: unknown }[]);
    if (compressed.compressed) {
      requestBody.messages = compressed.messages;
      console.log(`[Gateway] Compressed: saved ${compressed.savedChars} chars (~${Math.round(compressed.savedChars / 3)} tokens)`);
    }
  }

  const hasImagesInReq = Array.isArray(requestBody.messages) && (requestBody.messages as Array<{content: unknown}>).some(
    m => Array.isArray(m.content) && (m.content as Array<{type: string}>).some(p => p.type === "image_url")
  );
  let toolsStripped = false;
  if (hasImagesInReq && requestBody.tools) {
    console.log(`[FWD] Stripping tools (images+tools incompatible) for ${provider}/${actualModelId}`);
    delete requestBody.tools;
    delete requestBody.tool_choice;
    toolsStripped = true;
  }
  if (!toolsStripped) {
    try {
      const sql = getSqlClient();
      const rows = await sql<{ supports_tools: number }[]>`
        SELECT supports_tools FROM models WHERE provider = ${provider} AND model_id = ${actualModelId}
      `;
      if (rows.length > 0 && rows[0].supports_tools !== 1 && requestBody.tools) {
        console.log(`[FWD] Stripping tools (supports_tools=${rows[0].supports_tools}) for ${provider}/${actualModelId}`);
        delete requestBody.tools;
        delete requestBody.tool_choice;
        toolsStripped = true;
      }
    } catch { /* non-critical */ }
  }

  if (toolsStripped && Array.isArray(requestBody.messages)) {
    const msgs = requestBody.messages as Array<{ role: string; tool_calls?: unknown; tool_call_id?: string }>;
    requestBody.messages = msgs.filter(m => {
      if (m.role === "tool") return false;
      if (m.role === "assistant" && m.tool_calls) delete m.tool_calls;
      return true;
    });
    console.log(`[FWD] Cleaned tool messages: ${msgs.length} → ${(requestBody.messages as unknown[]).length} msgs`);
  }

  if (provider === "ollama") {
    requestBody.options = { ...(requestBody.options as Record<string, unknown> ?? {}), num_ctx: 65536 };
  }

  // P0-2: 8s per-attempt timeout for cloud providers, 25s for Ollama (local model load time)
  const timeoutMs = provider === "ollama" ? 25_000 : 8_000;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = externalSignal
    ? AbortSignal.any([timeoutSignal, externalSignal])
    : timeoutSignal;
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
    signal,
  });

  if (response.status === 429) {
    markKeyCooldown(provider, apiKey, 300000);
    const text = await response.text();
    return new Response(text, { status: 429, headers: response.headers });
  }

  return response;
}

// Improvement A: parallel hedge for top-2 cloud candidates
const FAST_STREAM_PROVIDERS_FOR_HEDGE = new Set(["groq", "cerebras", "together"]);

async function hedgeRace(
  topTwo: ModelRow[],
  body: Record<string, unknown>,
  isStream: boolean
): Promise<{ response: Response; winner: ModelRow; loserIdx: number }> {
  const controllers = topTwo.map(() => new AbortController());

  const attempts = topTwo.map((candidate, idx) =>
    forwardToProvider(candidate.provider, candidate.model_id, body, isStream, controllers[idx].signal)
      .then(res => {
        if (res.ok) return { response: res, winner: candidate, loserIdx: idx === 0 ? 1 : 0 };
        throw new Error(`HTTP ${res.status}`);
      })
  );

  const result = await Promise.any(attempts);
  // Cancel the loser
  controllers.forEach((c, i) => { if (topTwo[i] !== result.winner) c.abort(); });
  return result;
}

// Improvement F: probe Ollama /api/ps to see if model is loaded in memory
async function isOllamaModelLoaded(modelId: string): Promise<boolean> {
  try {
    const redis = getRedis();
    const cacheKey = `ollama:loaded:${modelId}`;
    const cached = await redis.get(cacheKey);
    if (cached === "1") return true;
    if (cached === "0") return false;

    const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    const res = await fetch(`${baseUrl}/api/ps`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) {
      await redis.set(cacheKey, "0", "EX", 30);
      return false;
    }
    const data = await res.json() as { models?: Array<{ model: string }> };
    const loaded = data.models?.some(m => m.model === modelId || m.model.startsWith(modelId)) ?? false;
    await redis.set(cacheKey, loaded ? "1" : "0", "EX", 30);
    return loaded;
  } catch {
    return false; // probe failed → skip to be safe
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 413 || status === 429 || status === 410 || status >= 500;
}

const XML_TOOL_CALL_RE = /<tool_call>|<functioncall>|<function_calls>/i;
const THINK_TAG_RE = /<think>[\s\S]*?<\/think>/g;

function isResponseBad(content: string, hadTools: boolean, hasToolCalls = false): string | null {
  // Empty content is acceptable ONLY if the model produced real tool_calls.
  // If hadTools=true but content is empty AND no tool_calls, the model returned
  // nothing useful — n้องกุ้ง (OpenClaw) agents will stall on this, so we reject
  // the response and retry the next candidate.
  if (!content && hadTools && !hasToolCalls) return "empty response with no tool_calls";
  if (!content && !hadTools) return "empty content";
  if (hadTools && XML_TOOL_CALL_RE.test(content)) return "tool_call XML leak";
  if (content.length > 0 && content.length < 3) return "response too short";
  return null;
}

function cleanResponseContent(content: string): string {
  return content.replace(THINK_TAG_RE, "").trim();
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (process.env.LOG_LEVEL === "debug") {
      const debugKeys = Object.keys(body);
      const toolCount = Array.isArray(body.tools) ? (body.tools as unknown[]).length : 0;
      const msgCount = Array.isArray(body.messages) ? (body.messages as unknown[]).length : 0;
      console.log(`[DEBUG] keys=[${debugKeys}] msgs=${msgCount} tools=${toolCount} stream=${body.stream}`);
    }

    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return openAIError(400, { message: "messages is required and must be a non-empty array", param: "messages" });
    }
    if (typeof body.model !== "string" && body.model !== undefined) {
      return openAIError(400, { message: "model must be a string", param: "model" });
    }

    const modelField = (body.model as string) || "auto";
    const isStream = body.stream === true;
    const caps = detectRequestCapabilities(body);
    const _reqTime = Date.now();
    const _reqMsg = extractUserMessage(body)?.slice(0, 80) ?? "-";
    console.log(`[REQ] ${modelField} | stream=${isStream} | img=${caps.hasImages} | tools=${caps.hasTools} | "${_reqMsg}"`);

    // Rate limiting — 100 req/60s per IP
    // Caddy sets X-Real-IP and X-Forwarded-For to exactly the true client IP
    // (trusted_proxies + header_up override in caddy-docker.Caddyfile). We
    // prefer X-Real-IP because it's a single value with no chain, and fall
    // back to the LAST entry of X-Forwarded-For (right-most = closest to us)
    // just in case the deployment sits behind another proxy someday.
    const xffChain = req.headers.get("x-forwarded-for")?.split(",").map(s => s.trim()).filter(Boolean) ?? [];
    const ip = req.headers.get("x-real-ip")?.trim()
      ?? xffChain[xffChain.length - 1]
      ?? "unknown";
    const rl = await checkRateLimit(`chat:${ip}`, 100, 60);
    if (!rl.allowed) {
      return new Response(
        JSON.stringify({ error: { message: "Rate limit exceeded. Try again in a moment.", type: "rate_limit_exceeded", code: "rate_limit_exceeded" } }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "X-RateLimit-Limit": "100",
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + rl.resetIn),
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    // Budget check — block at 95%
    const budget = await checkBudget();
    if (!budget.ok) {
      return openAIError(429, {
        message: `Daily budget exceeded (${budget.percentUsed.toFixed(1)}% used). Try again tomorrow or increase limit via /api/budget`,
        code: "rate_limit_exceeded",
      });
    }

    // Improvement C: response cache check (non-stream, low-temperature, no tools)
    const cachedHit = await getCachedResponse(body);
    if (cachedHit) {
      console.log(`[CACHE-HIT] ${cachedHit.provider}/${cachedHit.model}`);
      const cacheHeaders = new Headers();
      cacheHeaders.set("Content-Type", "application/json");
      cacheHeaders.set("X-BCProxy-Provider", cachedHit.provider);
      cacheHeaders.set("X-BCProxy-Model", cachedHit.model);
      cacheHeaders.set("X-BCProxy-Cache", "HIT");
      cacheHeaders.set("Access-Control-Allow-Origin", "*");
      const cacheBody = {
        id: `chatcmpl-cache-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: cachedHit.model,
        choices: [{
          index: 0,
          message: { role: "assistant", content: cachedHit.content },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
      return new Response(JSON.stringify(cacheBody), { status: 200, headers: cacheHeaders });
    }

    const parsed = parseModelField(modelField);

    if (budget.preferCheap && parsed.mode === "auto") {
      parsed.mode = "fast" as typeof parsed.mode;
    }

    const estInputTokens = estimateTokens(body);
    const promptCategory = detectPromptCategory(extractUserMessage(body) ?? "");

    // ---- Consensus mode ----
    if (parsed.mode === "consensus") {
      const userMsg = extractUserMessage(body);
      const consensusStart = Date.now();

      const allModels = await getAvailableModels(caps);
      const picked: ModelRow[] = [];
      const usedProviders = new Set<string>();
      for (const m of allModels) {
        if (!usedProviders.has(m.provider) && picked.length < 3) {
          picked.push(m);
          usedProviders.add(m.provider);
        }
      }

      if (picked.length > 0) {
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
            } catch { return null; }
          })
        );

        const valid = results.filter((r): r is NonNullable<typeof r> => r != null && r.content.length > 0);

        if (valid.length > 0) {
          valid.sort((a, b) => {
            if (b.content.length !== a.content.length) return b.content.length - a.content.length;
            return a.latency - b.latency;
          });

          const best = valid[0];
          const totalLatency = Date.now() - consensusStart;
          const usage = (best.json as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
          if (usage) {
            await trackTokenUsage(best.model.provider, best.model.model_id, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0);
          }

          await logGateway(
            "bcproxy/consensus", best.model.model_id, best.model.provider, 200, totalLatency,
            usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0, null, userMsg,
            `[consensus: ${valid.map((v) => v.model.provider + "/" + v.model.model_id).join(", ")}] ${best.content.slice(0, 300)}`
          );

          const headers = new Headers();
          headers.set("Content-Type", "application/json");
          headers.set("X-BCProxy-Provider", best.model.provider);
          headers.set("X-BCProxy-Model", best.model.model_id);
          headers.set("X-BCProxy-Consensus", valid.map((v) => `${v.model.provider}/${v.model.model_id}(${v.content.length}chars/${v.latency}ms)`).join(", "));
          headers.set("Access-Control-Allow-Origin", "*");
          return new Response(JSON.stringify(best.json), { status: 200, headers });
        }
      }

      parsed.mode = "auto" as typeof parsed.mode;
    }

    // ---- Direct provider routing ----
    if (parsed.mode === "direct") {
      const { provider, modelId } = parsed;
      const response = await forwardToProvider(provider!, modelId!, body, isStream);
      if (!response.ok && isRetryableStatus(response.status)) {
        const errText = await response.text();
        return openAIError(response.status, { message: errText || `Provider ${provider} returned ${response.status}` });
      }
      console.log(`[RES] ${response.status} | ${provider}/${modelId} | ${Date.now() - _reqTime}ms | direct`);
      return buildProxiedResponse(response, provider!, modelId!, isStream, estInputTokens);
    }

    // ---- Match by model string ----
    if (parsed.mode === "match") {
      const sql = getSqlClient();
      const rows = await sql<{ id: string; provider: string; model_id: string }[]>`
        SELECT id, provider, model_id FROM models WHERE id = ${parsed.modelId!} OR model_id = ${parsed.modelId!} LIMIT 1
      `;

      if (rows.length === 0) {
        return openAIError(404, { message: `The model '${parsed.modelId}' does not exist`, param: "model" });
      }

      const row = rows[0];
      const response = await forwardToProvider(row.provider, row.model_id, body, isStream);
      if (!response.ok && isRetryableStatus(response.status)) {
        const errText = await response.text();
        return openAIError(response.status, { message: errText || `Provider ${row.provider} returned ${response.status}` });
      }
      console.log(`[RES] ${response.status} | ${row.provider}/${row.model_id} | ${Date.now() - _reqTime}ms | match`);
      return buildProxiedResponse(response, row.provider, row.model_id, isStream, estInputTokens);
    }

    // ---- Smart routing: auto / fast / tools / thai ----
    const benchmarkCategory = caps.hasImages ? "vision" : promptCategory;
    const candidates = await selectModelsByMode(parsed.mode, caps, benchmarkCategory);
    if (process.env.LOG_LEVEL === "debug") {
      const candByProv: Record<string, number> = {};
      candidates.forEach(c => candByProv[c.provider] = (candByProv[c.provider] || 0) + 1);
      console.log(`[DEBUG] mode=${parsed.mode} candidates=${candidates.length} providers=${JSON.stringify(candByProv)}`);
    }

    if (!caps.hasTools) {
      const benchmarkBest = await getBestModelsByBenchmarkCategory(benchmarkCategory);
      if (benchmarkBest.length > 0) {
        const bestSet = new Set(benchmarkBest);
        const boosted = candidates.filter(c => bestSet.has(c.id));
        const rest = candidates.filter(c => !bestSet.has(c.id));
        candidates.splice(0, candidates.length, ...boosted, ...rest);
      }
      const learnedBest = await getBestModelsForCategory(promptCategory);
      if (learnedBest.length > 0) {
        const bestSet = new Set(learnedBest);
        const boosted = candidates.filter(c => bestSet.has(c.id));
        const rest = candidates.filter(c => !bestSet.has(c.id));
        candidates.splice(0, candidates.length, ...boosted, ...rest);
      }
    }

    if (process.env.LOG_LEVEL === "debug") {
      console.log(`[DEBUG] after boost: candidates=${candidates.length} top3=[${candidates.slice(0,3).map(c=>c.provider+'/'+c.model_id).join(', ')}]`);
    }

    let finalCandidates = candidates;
    if (finalCandidates.length === 0) {
      finalCandidates = await selectModelsByMode(parsed.mode, caps, benchmarkCategory);
    }
    if (finalCandidates.length === 0) {
      finalCandidates = await getAllModelsIncludingCooldown(caps);
    }
    if (finalCandidates.length === 0) {
      return openAIError(503, { message: "No models available. Worker scan has not completed yet." });
    }

    const MAX_RETRIES = 10;
    let lastError = "";
    const startTime = Date.now();
    const userMsg = extractUserMessage(body);
    const triedProviders = new Set<string>();
    const blockedProviders = new Set<string>();

    // Filter out provider cooldowns BEFORE retry loop (async Redis check)
    const cooldownChecks = await Promise.all(finalCandidates.map(c => isProviderCooledDownMem(c.provider)));
    const activeCandidates = finalCandidates.filter((_, i) => !cooldownChecks[i]);
    if (activeCandidates.length > 0) {
      finalCandidates = activeCandidates;
      if (process.env.LOG_LEVEL === "debug") console.log(`[DEBUG] after provider-cooldown filter: ${finalCandidates.length} candidates`);
    }

    // P1: Pre-flight size check — skip models whose context_length is too small for this request
    const estTokens = estimateTokens(body);
    const requiredContext = Math.ceil(estTokens * 1.4); // 30% headroom for response + safety margin
    const sizeFiltered = finalCandidates.filter(c => {
      if (!c.context_length || c.context_length >= requiredContext) return true;
      console.log(`[SIZE-SKIP] ${c.provider}/${c.model_id} context ${c.context_length} < required ${requiredContext}`);
      return false;
    });
    // Fall back to full list if everything was filtered (better to try than immediately 503)
    if (sizeFiltered.length > 0) {
      finalCandidates = sizeFiltered;
      if (process.env.LOG_LEVEL === "debug") console.log(`[DEBUG] after size filter: ${finalCandidates.length} candidates (required ctx ${requiredContext})`);
    } else {
      console.log(`[SIZE-SKIP] All candidates too small for ${requiredContext} tokens — using full list as fallback`);
    }

    // Weighted Load Balancing
    let spreadCandidates: typeof finalCandidates;

    if (caps.hasTools) {
      const nonOllama = finalCandidates.filter(c => c.provider !== "ollama");
      const ollama = finalCandidates.filter(c => c.provider === "ollama");
      spreadCandidates = [...nonOllama, ...ollama];
    } else {
      spreadCandidates = [];
      const byProvider: Record<string, typeof finalCandidates> = {};
      for (const c of finalCandidates) {
        (byProvider[c.provider] ??= []).push(c);
      }
      const providerOrder = await Promise.all(
        Object.entries(byProvider).map(async ([prov, models]) => {
          const avgLat = models.reduce((s, m) => s + (m.avg_latency ?? 9999999), 0) / models.length;
          const avgScore = models.reduce((s, m) => s + (m.avg_score ?? 0), 0) / models.length;
          const repScores = await Promise.all(models.map(m => getReputationScore(m.id)));
          const avgRep = repScores.reduce((s, r) => s + r, 0) / repScores.length;
          const weight = prov === "ollama" ? -Infinity : avgScore * 1000 * (avgRep / 100) - avgLat;
          return { models, weight };
        })
      );
      providerOrder.sort((a, b) => b.weight - a.weight);
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
    }

    if (process.env.LOG_LEVEL === "debug") console.log(`[DEBUG] spread=${spreadCandidates.length} top5=[${spreadCandidates.slice(0,5).map(c=>c.provider+'/'+c.model_id).join(', ')}]`);

    const TOTAL_TIMEOUT_MS = 20_000;

    // Improvement A: parallel hedge top-2 cloud candidates (skip for stream / tools)
    let hedgeStartIdx = 0;
    if (
      !isStream &&
      !caps.hasTools &&
      spreadCandidates.length >= 2 &&
      spreadCandidates[0].provider !== "ollama" &&
      spreadCandidates[1].provider !== "ollama"
    ) {
      const topTwo = spreadCandidates.slice(0, 2);
      try {
        const hedgeResult = await hedgeRace(topTwo, body, isStream);
        const { response: hedgeResp, winner, loserIdx } = hedgeResult;
        const loser = topTwo[loserIdx];
        const latency = Date.now() - startTime;
        console.log(`[HEDGE-WIN] ${winner.provider}/${winner.model_id} vs ${loser.provider}/${loser.model_id} | ${latency}ms`);
        // Record winner as success, loser as neutral (cancelled)
        await recordProviderSuccessMem(winner.provider);
        // Parse and return the hedge winner response
        try {
          const cloned = hedgeResp.clone();
          const json = await cloned.json() as { choices?: Array<{ message?: { content?: string; reasoning?: string; reasoning_content?: string; tool_calls?: unknown[] } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
          const firstMsg = json.choices?.[0]?.message;
          let content = firstMsg?.content ?? "";
          // Same reasoning→content fallback as the sequential path
          if (!content && firstMsg) {
            const fallback = firstMsg.reasoning || firstMsg.reasoning_content;
            if (fallback) {
              content = fallback;
              firstMsg.content = fallback;
              console.log(`[HEDGE-REASONING-FALLBACK] ${winner.provider}/${winner.model_id} — moved ${fallback.length} chars`);
            }
          }
          const hasToolCalls = Array.isArray(firstMsg?.tool_calls) && (firstMsg!.tool_calls!.length > 0);
          const badReason = isResponseBad(content, caps.hasTools, hasToolCalls);
          if (badReason) {
            console.log(`[HEDGE-BAD] ${winner.provider}/${winner.model_id} — ${badReason}`);
            // Fall through to sequential retry
          } else {
            if (content && THINK_TAG_RE.test(content)) {
              content = cleanResponseContent(content);
              if (json.choices?.[0]?.message) json.choices[0].message.content = content;
            }
            const usage = json.usage;
            await logGateway(modelField, winner.model_id, winner.provider, 200, latency,
              usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0, null, userMsg, content?.slice(0, 500) ?? null);
            await recordRoutingResult(winner.id, winner.provider, promptCategory, true, latency);
            await trackTokenUsage(winner.provider, winner.model_id, usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0);
            // P4: record token consumption for TPM tracking
            const hedgeTotalTokens = (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0);
            recordTokenConsumption(winner.provider, hedgeTotalTokens).catch(() => {});
            recordBattleEvent(outcomeFromLatency(latency, true)).catch(() => { /* cosmetic */ });
            if (content) {
              setCachedResponse(body, { content, provider: winner.provider, model: winner.model_id }).catch(() => { /* non-critical */ });
            }
            const hedgeHeaders = new Headers();
            hedgeHeaders.set("Content-Type", "application/json");
            hedgeHeaders.set("X-BCProxy-Provider", winner.provider);
            hedgeHeaders.set("X-BCProxy-Model", winner.model_id);
            hedgeHeaders.set("X-BCProxy-Hedge", "true");
            hedgeHeaders.set("Access-Control-Allow-Origin", "*");
            console.log(`[RES] 200 | ${winner.provider}/${winner.model_id} | ${latency}ms | hedge | "${_reqMsg}"`);
            return new Response(JSON.stringify(json), { status: 200, headers: hedgeHeaders });
          }
        } catch {
          // JSON parse failed — fall through to sequential
        }
      } catch {
        // Both hedge candidates failed
        const latency = Date.now() - startTime;
        console.log(`[HEDGE-LOSS] both top-2 failed | ${latency}ms — continuing sequential`);
        await recordProviderFailureMem(topTwo[0].provider);
        await recordProviderFailureMem(topTwo[1].provider);
        await recordCircuitFailure(topTwo[0].provider);
        await recordCircuitFailure(topTwo[1].provider);
      }
      // After hedge (win bad-response or loss), skip first 2 in sequential loop
      hedgeStartIdx = 2;
    }

    for (let i = hedgeStartIdx, tried = 0; i < spreadCandidates.length && tried < MAX_RETRIES; i++) {
      if (Date.now() - startTime > TOTAL_TIMEOUT_MS) {
        console.log(`[TIMEOUT] Total retry time exceeded ${TOTAL_TIMEOUT_MS}ms — stopping`);
        break;
      }
      const candidate = spreadCandidates[i];
      const { provider, model_id: actualModelId, id: dbModelId } = candidate;
      if (blockedProviders.has(provider)) continue;
      if (await isProviderCooledDownMem(provider)) continue;
      if (await isCircuitOpen(provider)) { console.log(`[CIRCUIT-SKIP] ${provider} circuit open`); continue; }
      tried++;
      triedProviders.add(provider);
      // Record attempt for sample-size guard (regardless of outcome)
      recordProviderAttempt(provider).catch(() => { /* non-critical */ });

      // Improvement F: skip cold Ollama when cloud alternatives exist
      if (provider === "ollama") {
        const hasCloudAlternative = spreadCandidates.slice(i + 1).some(c => c.provider !== "ollama");
        if (hasCloudAlternative) {
          const loaded = await isOllamaModelLoaded(actualModelId);
          if (!loaded) {
            console.log(`[OLLAMA-SKIP] ${actualModelId} not loaded in memory — skipping (cloud alternatives available)`);
            continue;
          }
        }
      }

      // P3: Skip Ollama for tool requests when cloud alternatives exist
      if (provider === "ollama" && caps.hasTools) {
        const hasCloudLeft = spreadCandidates.slice(i).some(c => c.provider !== "ollama" && !blockedProviders.has(c.provider));
        if (hasCloudLeft) {
          console.log(`[OLLAMA-SKIP-TOOLS] ${actualModelId} — tools requested, cloud alternatives exist`);
          continue;
        }
      }

      // P2: Skip known-broken tool models
      const candidateKey = `${provider}:${actualModelId}`;
      if (caps.hasTools && KNOWN_BROKEN_TOOL_MODELS.has(candidateKey)) {
        console.log(`[BROKEN-TOOL-SKIP] ${candidateKey} — known broken tool support`);
        continue;
      }

      // P4: Skip if provider TPM budget is exhausted
      const estProjected = estTokens + 2000; // estimated response budget
      if (!(await hasTpmHeadroom(provider, estProjected))) {
        continue;
      }

      // Check if this attempt is a half-open probe
      let wasProbing = false;
      try {
        const redis = getRedis();
        const cbState = await redis.get(`cb:open:${provider}`);
        wasProbing = cbState === "half-open";
      } catch { /* ignore */ }

      try {
        const response = await forwardToProvider(provider, actualModelId, body, isStream);

        if (response.ok) {
          const latency = Date.now() - startTime;
          await recordProviderSuccessMem(provider);
          if (wasProbing) await recordCircuitProbeResult(provider, true);
          const SLOW_THRESHOLD_MS = 10_000;
          const SLOW_COOLDOWN_MINUTES = 10;
          if (latency > SLOW_THRESHOLD_MS && provider !== "ollama") {
            await logCooldown(dbModelId, `Slow response: ${(latency / 1000).toFixed(1)}s > ${SLOW_THRESHOLD_MS / 1000}s threshold`, 0, SLOW_COOLDOWN_MINUTES);
            await emitEvent("provider_error", `${provider}/${actualModelId} ช้ามาก (${(latency / 1000).toFixed(1)}s)`, `ตอบช้าเกิน ${SLOW_THRESHOLD_MS / 1000}s → cooldown ${SLOW_COOLDOWN_MINUTES} นาที`, provider, actualModelId, "warn");
          } else {
            try {
              const sql = getSqlClient();
              await sql`DELETE FROM health_logs WHERE model_id = ${dbModelId} AND cooldown_until > now()`;
            } catch { /* silent */ }
          }

          if (!isStream) {
            try {
              const cloned = response.clone();
              const json = await cloned.json() as { choices?: Array<{ message?: { content?: string; reasoning?: string; reasoning_content?: string; tool_calls?: unknown[] } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
              const firstMsg = json.choices?.[0]?.message;
              let content = firstMsg?.content ?? "";

              // Some providers (Mistral Large, Ollama qwen, DeepSeek) put the
              // actual answer in `reasoning` or `reasoning_content` instead of
              // `content`. Fall back so downstream clients (n้องกุ้ง/OpenClaw)
              // see a non-empty response.
              if (!content && firstMsg) {
                const fallback = firstMsg.reasoning || firstMsg.reasoning_content;
                if (fallback) {
                  content = fallback;
                  firstMsg.content = fallback;
                  console.log(`[REASONING-FALLBACK] ${provider}/${actualModelId} — moved ${fallback.length} chars from reasoning→content`);
                }
              }

              const hasToolCalls = Array.isArray(firstMsg?.tool_calls) && (firstMsg!.tool_calls!.length > 0);

              const badReason = isResponseBad(content, caps.hasTools, hasToolCalls);
              if (badReason) {
                console.log(`[BAD-RESPONSE] ${provider}/${actualModelId} — ${badReason}: "${content.slice(0, 100)}"`);
                await logCooldown(dbModelId, badReason, 0, 5);
                await recordRoutingResult(dbModelId, provider, promptCategory, false, latency);
                lastError = `${provider}/${actualModelId}: ${badReason}`;
                continue;
              }

              if (content && THINK_TAG_RE.test(content)) {
                content = cleanResponseContent(content);
                if (json.choices?.[0]?.message) json.choices[0].message.content = content;
              }

              const usage = json.usage;
              await logGateway(modelField, actualModelId, provider, 200, latency,
                usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0, null, userMsg, content?.slice(0, 500) ?? null);
              await recordRoutingResult(dbModelId, provider, promptCategory, true, latency);

              const headers = new Headers();
              headers.set("Content-Type", "application/json");
              headers.set("X-BCProxy-Provider", provider);
              headers.set("X-BCProxy-Model", actualModelId);
              headers.set("Access-Control-Allow-Origin", "*");

              if (json.choices) {
                for (const choice of json.choices) {
                  const msg = choice.message;
                  if (msg && Array.isArray(msg.content)) {
                    msg.content = (msg.content as Array<{ type: string; text?: string }>)
                      .filter((p) => p.type === "text").map((p) => p.text).join("");
                  }
                }
              }

              await trackTokenUsage(provider, actualModelId, usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0);
              // P4: record token consumption for TPM tracking
              const totalTokens = (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0);
              recordTokenConsumption(provider, totalTokens).catch(() => {});
              // Improvement C: store in response cache (non-stream, low-temp, no tools)
              if (content) {
                setCachedResponse(body, { content, provider, model: actualModelId }).catch(() => { /* non-critical */ });
              }
              recordBattleEvent(outcomeFromLatency(latency, true)).catch(() => { /* cosmetic */ });
              console.log(`[RES] 200 | ${provider}/${actualModelId} | ${latency}ms | "${_reqMsg}"`);
              return new Response(JSON.stringify(json), { status: 200, headers });
            } catch {
              // JSON parse failed — fall through
            }
          }

          const proxied = await buildProxiedResponse(response, provider, actualModelId, isStream, estInputTokens);
          const streamLatency = Date.now() - startTime;
          await recordRoutingResult(dbModelId, provider, promptCategory, true, streamLatency);
          await logGateway(modelField, actualModelId, provider, 200, streamLatency, 0, 0, null, userMsg, "[stream]");
          recordBattleEvent(outcomeFromLatency(streamLatency, true)).catch(() => { /* cosmetic */ });
          console.log(`[RES] 200 | ${provider}/${actualModelId} | ${streamLatency}ms | "${_reqMsg}"`);
          return proxied;
        }

        const errText = await response.text().catch(() => "");
        lastError = `${provider}/${actualModelId}: HTTP ${response.status}`;
        await recordRoutingResult(dbModelId, provider, promptCategory, false, Date.now() - startTime);
        await recordProviderFailureMem(provider);
        await recordCircuitFailure(provider);
        if (wasProbing) await recordCircuitProbeResult(provider, false);
        const st = response.status;
        console.log(`[RETRY] ${tried}/${MAX_RETRIES} | ${provider}/${actualModelId} → HTTP ${st} | ${errText.slice(0, 200)}`);
        if (provider !== "ollama" && (st === 400 || st === 402 || st === 429 || st === 413 || st === 422 || st === 410 || st === 404 || st >= 500 || st === 401 || st === 403)) {
          await logCooldown(dbModelId, `HTTP ${st}: ${errText}`, st);
          if (st === 402) {
            await cooldownProvider(provider, st, errText.slice(0, 200));
            blockedProviders.add(provider);
            await emitEvent("provider_error", `${provider} quota หมด (HTTP 402)`, errText.slice(0, 200), provider, actualModelId, "error");
          }
          if (st === 429 || st === 401 || st === 403) blockedProviders.add(provider);
          if (st === 404) blockedProviders.add(provider);
          if (st === 410) {
            await emitEvent("provider_error", `${provider}/${actualModelId} ถูกถอดแล้ว (HTTP 410 Gone)`, errText.slice(0, 200), provider, actualModelId, "error");
          } else if (st >= 500) {
            await emitEvent("provider_error", `${provider} ล่ม (HTTP ${st})`, errText.slice(0, 200), provider, actualModelId, "error");
          }
        }
        continue;
      } catch (err) {
        const errStr = String(err);
        const isTimeout = errStr.includes("TimeoutError") || errStr.includes("timeout") || errStr.includes("AbortError");
        lastError = `${provider}/${actualModelId}: ${errStr}`;
        if (isTimeout) {
          console.log(`[TIMEOUT-ATTEMPT] ${provider}/${actualModelId} exceeded per-attempt timeout — applying 5min cooldown`);
          await logCooldown(dbModelId, `attempt timeout: ${errStr.slice(0, 100)}`, 0, 5);
        } else {
          await logCooldown(dbModelId, lastError);
        }
        await recordRoutingResult(dbModelId, provider, promptCategory, false, Date.now() - startTime);
        await recordProviderFailureMem(provider);
        await recordCircuitFailure(provider);
        if (wasProbing) await recordCircuitProbeResult(provider, false);
        await emitEvent("provider_error", `${provider} เชื่อมต่อไม่ได้`, errStr.slice(0, 200), provider, actualModelId, "warn");
        continue;
      }
    }

    const latency = Date.now() - startTime;
    await logGateway(modelField, null, null, 503, latency, 0, 0, lastError.slice(0, 300), userMsg, null);
    recordBattleEvent("fail").catch(() => { /* cosmetic */ });
    console.log(`[RES] 503 | ${triedProviders.size} providers tried, ${blockedProviders.size} blocked | ${latency}ms | ${lastError.slice(0, 120)}`);
    return openAIError(503, {
      message: `All ${Math.min(MAX_RETRIES, spreadCandidates.length)} models from ${triedProviders.size} providers failed: ${lastError}`,
    });
  } catch (err) {
    console.error("[Gateway] Unexpected error:", err);
    return openAIError(500, { message: String(err) });
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
  headers.set("Access-Control-Allow-Origin", "*");

  if (stream && upstream.body) {
    const reader = upstream.body.getReader();
    let totalBytes = 0;
    const passthrough = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          const estOutputTokens = Math.ceil(totalBytes / 3);
          trackTokenUsage(provider, modelId, estimatedInputTokens, estOutputTokens);
          controller.close();
          return;
        }
        totalBytes += value.byteLength;
        controller.enqueue(value);
      },
    });
    return new Response(passthrough, { status: upstream.status, headers });
  }

  try {
    const text = await upstream.text();
    const json = JSON.parse(text);

    if (json.choices) {
      for (const choice of json.choices) {
        const msg = choice.message;
        if (msg && (!msg.content || msg.content === "") && msg.reasoning) {
          msg.content = msg.reasoning;
        }
      }
    }

    if (json.choices) {
      for (const choice of json.choices) {
        const toolCalls = choice.message?.tool_calls;
        if (Array.isArray(toolCalls)) {
          for (const tc of toolCalls) {
            if (tc.function?.arguments && typeof tc.function.arguments === "string") {
              try {
                const args = JSON.parse(tc.function.arguments);
                for (const [key, val] of Object.entries(args)) {
                  if (typeof val === "string" && /^\d+$/.test(val)) args[key] = Number(val);
                }
                tc.function.arguments = JSON.stringify(args);
              } catch { /* keep original */ }
            }
          }
        }
      }
    }

    if (json.choices) {
      for (const choice of json.choices) {
        const msg = choice.message;
        if (msg && Array.isArray(msg.content)) {
          msg.content = msg.content.filter((p: { type: string }) => p.type === "text").map((p: { text: string }) => p.text).join("");
        }
      }
    }

    ensureChatCompletionFields(json, provider, modelId);

    const content = json.choices?.[0]?.message?.content ?? "";
    autoDetectComplaint(provider, modelId, content);

    const usage = json.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    if (usage) {
      await trackTokenUsage(provider, modelId, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0);
    } else {
      const estOutput = Math.ceil(text.length / 3);
      await trackTokenUsage(provider, modelId, estimatedInputTokens, estOutput);
    }

    return new Response(JSON.stringify(json), { status: upstream.status, headers });
  } catch {
    return new Response(upstream.body, { status: upstream.status, headers });
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
