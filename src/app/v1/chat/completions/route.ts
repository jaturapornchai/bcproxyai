import { NextRequest } from "next/server";
import { getSqlClient } from "@/lib/db/schema";
import { getNextApiKey, markKeyCooldown, hasProviderKey } from "@/lib/api-keys";
import { resolveProviderUrl, resolveProviderAuth } from "@/lib/provider-resolver";
import { clearCache } from "@/lib/cache";
import { registerInvalidator as registerModelListInvalidator } from "@/lib/model-list-cache";
import { compressMessages } from "@/lib/prompt-compress";
import { openAIError, ensureChatCompletionFields } from "@/lib/openai-compat";
import { autoDetectComplaint } from "@/lib/auto-complaint";
import { getReputationScore } from "@/lib/worker/complaint";
import { detectPromptCategory, recordRoutingResult, getBestModelsForCategory, getBestModelsByBenchmarkCategory, emitEvent, getRealAvgLatency, recordThaiQualityPenalty } from "@/lib/routing-learn";
import { getRedis } from "@/lib/redis";
import { checkRateLimit } from "@/lib/rate-limit";
import { getCachedResponse, setCachedResponse } from "@/lib/response-cache";
import { recordBattleEvent, outcomeFromLatency } from "@/lib/battle-score";
import { hasTpmHeadroom, recordTokenConsumption } from "@/lib/tpm-tracker";
import { recordOutcome, getProviderScore, getModelScore, isRecentlyDead } from "@/lib/live-score";
import { isProviderEnabledSync } from "@/lib/provider-toggle";
import { canFitRequest, parseLimitHeaders, parseLimitError, recordLimit } from "@/lib/provider-limits";
import { recordOutcomeLearning, recordFailStreak, canHandleTokens, getCategoryWinners, detectCategory, isModelUnhealthyForCategory } from "@/lib/learning";
import { upstreamAgent } from "@/lib/upstream-agent";

// ── Category mapping: routing category → exam question category ──
const ROUTING_TO_EXAM_CAT: Record<string, string> = {
  "thai": "thai",
  "code": "code",
  "math": "math",
  "tools": "tools",
  "vision": "vision",
  "long-context": "comprehension",
  "medium-context": "instruction",
  "translate": "thai",
  "knowledge": "reasoning",
  "general": "general",  // will use overall score
};

// Prompt/response content logging — default OFF in prod to avoid PII leakage
// into docker logs / journalctl. Opt-in with GATEWAY_LOG_PROMPTS=1 when
// debugging locally.
const LOG_PROMPTS = process.env.GATEWAY_LOG_PROMPTS === "1";
function redactForLog(s: string | null | undefined): string {
  if (!s) return "-";
  if (LOG_PROMPTS) return s.slice(0, 80);
  return `<${s.length}ch>`;
}

// Slow threshold แปรผันตาม context size — request ใหญ่ช้ากว่าปกติ
function slowThresholdMs(estInputTokens: number): number {
  if (estInputTokens > 20_000) return 15_000;
  if (estInputTokens > 10_000) return 10_000;
  if (estInputTokens > 5_000)  return 7_000;
  return 5_000;
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

async function recordProviderSuccessMem(provider: string, modelId: string): Promise<void> {
  try {
    const redis = getRedis();
    const succKey = `cb:succ:${provider}:${modelId}`;
    // Pipeline: del fail-streak + read current success count in one RTT.
    const results = await redis.pipeline()
      .del(`fs:provider:${provider}`)
      .get(succKey)
      .exec();
    const cur = results?.[1]?.[1] as string | null;
    const newVal = (Number(cur ?? 0) + 1).toString();
    await redis.set(succKey, newVal, "EX", 30);
  } catch { /* ignore */ }
  _memFailures.delete(provider);
}

// P1-3: Circuit breaker — check if (provider, model) circuit is open
// Per-model so one broken model doesn't drag the whole provider down.
async function isCircuitOpen(provider: string, modelId: string): Promise<boolean> {
  try {
    const redis = getRedis();
    const cbKey = `cb:open:${provider}:${modelId}`;
    // Pipeline get + ttl in one RTT instead of two
    const results = await redis.pipeline()
      .get(cbKey)
      .ttl(cbKey)
      .exec();
    const val = results?.[0]?.[1] as string | null;
    const ttl = Number(results?.[1]?.[1] ?? -2);
    if (val === null) return false;
    if (val === "half-open") return false; // allow probe
    // val === "open" — U2: shorter 30s total cooldown, promote to half-open in the last 5s
    if (ttl > 0 && ttl <= 5) {
      await redis.set(cbKey, "half-open", "EX", 30);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// P1-3: Record result of a half-open probe attempt (per model)
async function recordCircuitProbeResult(provider: string, modelId: string, success: boolean): Promise<void> {
  try {
    const redis = getRedis();
    const cbKey = `cb:open:${provider}:${modelId}`;
    const state = await redis.get(cbKey);
    if (state !== "half-open") return; // not currently probing
    if (success) {
      // Probe succeeded → fully close circuit + reset counters
      await redis.del(cbKey);
      await redis.del(`cb:fail:${provider}:${modelId}`);
      await redis.del(`cb:succ:${provider}:${modelId}`);
      console.log(`[CIRCUIT-CLOSE] ${provider}/${modelId} — half-open probe succeeded`);
    } else {
      // Probe failed → re-open for 4 minutes (escalating)
      await redis.set(cbKey, "open", "EX", 240);
      console.log(`[CIRCUIT-REOPEN] ${provider}/${modelId} — half-open probe failed → 4min`);
    }
  } catch { /* ignore */ }
}

// P1-3: Record failure for circuit breaker rolling window (per model)
async function recordCircuitFailure(provider: string, modelId: string): Promise<void> {
  try {
    const redis = getRedis();
    const failKey = `cb:fail:${provider}:${modelId}`;
    const succKey = `cb:succ:${provider}:${modelId}`;
    // Pipeline: read both counters in 1 RTT
    const reads = await redis.pipeline().get(failKey).get(succKey).exec();
    const curFail = Number(reads?.[0]?.[1] ?? 0);
    const succs = Number(reads?.[1]?.[1] ?? 0);
    const fails = curFail + 1;
    const total = fails + succs;
    // Build the write pipeline — always set the new fail count, maybe also
    // trip the circuit if success rate dropped below threshold.
    const writes = redis.pipeline().set(failKey, String(fails), "EX", 30);
    if (total >= 5 && succs / total < 0.3) {
      writes.set(`cb:open:${provider}:${modelId}`, "open", "EX", 30);
      console.log(`[CIRCUIT-OPEN] ${provider}/${modelId} — success rate ${((succs / total) * 100).toFixed(0)}% < 30% → circuit open 30s`);
    }
    await writes.exec();
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
  // นับเฉพาะ text — ไม่นับ image base64 (แต่ละรูป ~1K tokens คงที่)
  let textLen = 0;
  let imageCount = 0;
  const msgs = body.messages;
  if (Array.isArray(msgs)) {
    for (const msg of msgs as Array<{ content?: unknown }>) {
      if (typeof msg.content === "string") {
        textLen += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content as Array<{ type?: string; text?: string; image_url?: unknown }>) {
          if (part.type === "text" && part.text) textLen += part.text.length;
          else if (part.type === "image_url") imageCount++;
        }
      }
    }
  }
  // tools/other fields
  const toolsStr = body.tools ? JSON.stringify(body.tools) : "";
  textLen += toolsStr.length;
  return Math.ceil(textLen / 3) + imageCount * 1000;
}

const VISION_PRIORITY_PROVIDERS = ["google", "groq", "ollama", "github"];

// P2: OpenRouter free-tier models that claim supports_tools=1 in DB but 404 at runtime
// NOTE: No hardcoded broken tool models.
// System learns from production signals: model_samples (fail count per category=tools),
// category_winners (tools category loss_streak), and exam_answers (tools question pass rate).
// See `recordOutcomeLearning()` and `getCategoryWinners("tools")`.

// In-memory cache for the (heavy) model-list query — 4-table JOIN that hits
// every chat request. 30-sec TTL is short enough that health flips propagate
// quickly without thundering the DB.
//
// Key: caps shape that affects the SQL (vision/tools/json) so we don't return
// vision-required rows to a tools query. estTokens is excluded — sort tweak
// only, not row filter.
const modelListCache = new Map<string, { rows: ModelRow[]; exp: number }>();
const MODEL_LIST_TTL_MS = 30_000;
function modelListCacheKey(caps: RequestCapabilities): string {
  return `${caps.hasImages ? 1 : 0}:${caps.hasTools ? 1 : 0}:${caps.needsJsonSchema ? 1 : 0}`;
}
// Register with the shared hook so health/scan workers can invalidate.
registerModelListInvalidator(() => modelListCache.clear());

// ─── Sticky routing cache ─────────────────────────────────────────────────
// (client_ip, category) → last model_id that succeeded < 30s ago.
// Rationale: consecutive requests from the same client doing the same kind of
// thing (e.g. code assistant looping through files) tend to be happy with the
// same model. Bumping that model to position 0 in the candidate list hits
// warm TCP sockets + upstream KV cache + removes a sort tiebreaker coin-flip.
//
// Non-authoritative: still goes through all skip checks (cooldown / circuit /
// TPM). If the sticky model is dead now, we fall through to normal ranking.
interface StickyEntry { provider: string; modelId: string; exp: number }
const stickyRoute = new Map<string, StickyEntry>();
const STICKY_TTL_MS = 30_000;
const STICKY_MAX_SIZE = 5_000; // LRU-ish cap to prevent unbounded growth

function stickyKey(clientIp: string, category: string): string {
  return `${clientIp}:${category}`;
}
function getSticky(clientIp: string, category: string): { provider: string; modelId: string } | null {
  const e = stickyRoute.get(stickyKey(clientIp, category));
  if (!e) return null;
  if (e.exp < Date.now()) { stickyRoute.delete(stickyKey(clientIp, category)); return null; }
  return { provider: e.provider, modelId: e.modelId };
}
function setSticky(clientIp: string, category: string, provider: string, modelId: string): void {
  // Evict oldest entries when map grows past cap — Map iterates in insertion order
  if (stickyRoute.size >= STICKY_MAX_SIZE) {
    const firstKey = stickyRoute.keys().next().value;
    if (firstKey !== undefined) stickyRoute.delete(firstKey);
  }
  stickyRoute.set(stickyKey(clientIp, category), { provider, modelId, exp: Date.now() + STICKY_TTL_MS });
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of stickyRoute.entries()) {
    if (v.exp < now) stickyRoute.delete(k);
  }
}, 60_000).unref?.();

async function getAvailableModels(caps: RequestCapabilities, benchmarkCategory?: string, estTokens?: number): Promise<ModelRow[]> {
  const ck = modelListCacheKey(caps);
  const now = Date.now();
  const hit = modelListCache.get(ck);
  if (hit && hit.exp > now) {
    // Sort tweak depends on estTokens — re-apply on cached rows
    return reorderForLatency([...hit.rows], estTokens);
  }

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

  // ระบบสอบใหม่: ใช้ exam_attempts เป็น source of truth
  // ต้อง passed=true ใน attempt ล่าสุดถึงจะได้ทำงาน
  void benchmarkCategory; // kept for API compat (was used for per-category benchmark)
  const rows = await sql.unsafe(`
    SELECT
      m.id, m.provider, m.model_id, m.supports_tools, m.supports_vision, m.tier, m.context_length,
      COALESCE(ex.score_pct, 0) as avg_score,
      COALESCE(rs.avg_lat_real, ex.total_latency_ms::float, 9999999) as avg_latency,
      h.status as health_status,
      h.cooldown_until
      ${visionBoost}
    FROM models m
    INNER JOIN (
      SELECT DISTINCT ON (model_id)
        model_id, score_pct, passed, total_latency_ms
      FROM exam_attempts
      WHERE finished_at IS NOT NULL
      ORDER BY model_id, started_at DESC
    ) ex ON m.id = ex.model_id AND ex.score_pct >= 50
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
      ex.score_pct DESC,
      m.context_length DESC,
      COALESCE(rs.avg_lat_real, ex.total_latency_ms::float, 9999999) ASC
  `) as ModelRow[];

  modelListCache.set(ck, { rows: [...rows], exp: now + MODEL_LIST_TTL_MS });
  return reorderForLatency(rows, estTokens);
}

// Pure sort tweak split out so cache hits can re-apply it cheaply.
function reorderForLatency(rows: ModelRow[], estTokens?: number): ModelRow[] {
  // Apply Ollama slowness penalty: push Ollama to end if any cloud provider is available
  const cloudRows = rows.filter(r => r.provider !== "ollama");
  const ollamaRows = rows.filter(r => r.provider === "ollama");
  let reorderedRows = cloudRows.length > 0 ? [...cloudRows, ...ollamaRows] : rows;

  // Improvement D: fast-stream provider boost — subtract 500ms from effective latency for sorting
  const FAST_STREAM_PROVIDERS = new Set(["groq", "cerebras", "together"]);
  if (reorderedRows.length > 1) {
    reorderedRows = [...reorderedRows].sort((a, b) => {
      const adjA = (a.avg_latency ?? 9999999)
        - (FAST_STREAM_PROVIDERS.has(a.provider) ? 500 : 0)
        + (estTokens != null && estTokens > 10_000 && a.provider === "mistral" ? 5_000 : 0);
      const adjB = (b.avg_latency ?? 9999999)
        - (FAST_STREAM_PROVIDERS.has(b.provider) ? 500 : 0)
        + (estTokens != null && estTokens > 10_000 && b.provider === "mistral" ? 5_000 : 0);
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

// ─── Batched gateway log writes ───────────────────────────────────────────
// Under load we insert 1 row per completed request. At 100 req/s that's 100
// sync INSERTs + 100 WAL syncs. Batching 100ms windows collapses those into
// one multi-row INSERT, cutting DB round-trips + WAL amplification ~90%+.
//
// Fire-and-forget: caller doesn't await. We accept that a process crash could
// drop up to 100ms of logs — that's cheaper than the latency win for every
// successful request.
interface GatewayLogRow {
  requestModel: string;
  resolvedModel: string | null;
  provider: string | null;
  status: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  error: string | null;
  userMessage: string | null;
  assistantMessage: string | null;
  requestId: string | null;
  clientIp: string | null;
}

const LOG_FLUSH_INTERVAL_MS = 100;
const LOG_FLUSH_MAX_BATCH = 200; // hard cap to avoid giant INSERTs
let _logBuffer: GatewayLogRow[] = [];
let _logFlushTimer: ReturnType<typeof setTimeout> | null = null;

async function flushGatewayLogs(): Promise<void> {
  if (_logBuffer.length === 0) return;
  const batch = _logBuffer.splice(0, LOG_FLUSH_MAX_BATCH);
  try {
    const sql = getSqlClient();
    // postgres.js multi-row INSERT: sql(rows, col1, col2, ...) expands to
    // (v1_1, v1_2, ...), (v2_1, v2_2, ...) while keeping each field parameterized
    const rows = batch.map(r => ({
      request_model: r.requestModel,
      resolved_model: r.resolvedModel,
      provider: r.provider,
      status: r.status,
      latency_ms: r.latencyMs,
      input_tokens: r.inputTokens,
      output_tokens: r.outputTokens,
      error: r.error,
      user_message: r.userMessage?.slice(0, 500) ?? null,
      assistant_message: r.assistantMessage?.slice(0, 500) ?? null,
      request_id: r.requestId,
      client_ip: r.clientIp,
    }));
    await sql`
      INSERT INTO gateway_logs ${sql(rows, "request_model", "resolved_model", "provider",
        "status", "latency_ms", "input_tokens", "output_tokens", "error",
        "user_message", "assistant_message", "request_id", "client_ip")}
    `;
  } catch {
    // non-critical — logs are observability, not correctness
  }
  // If more accumulated while we were flushing, schedule another pass
  if (_logBuffer.length > 0 && !_logFlushTimer) {
    _logFlushTimer = setTimeout(() => { _logFlushTimer = null; void flushGatewayLogs(); }, LOG_FLUSH_INTERVAL_MS);
  }
}

function logGateway(
  requestModel: string, resolvedModel: string | null, provider: string | null,
  status: number, latencyMs: number, inputTokens: number, outputTokens: number,
  error: string | null, userMessage: string | null, assistantMessage: string | null,
  requestId: string | null = null, clientIp: string | null = null
): void {
  _logBuffer.push({
    requestModel, resolvedModel, provider, status, latencyMs,
    inputTokens, outputTokens, error, userMessage, assistantMessage,
    requestId, clientIp,
  });
  // Schedule flush if not already pending
  if (!_logFlushTimer) {
    _logFlushTimer = setTimeout(() => { _logFlushTimer = null; void flushGatewayLogs(); }, LOG_FLUSH_INTERVAL_MS);
  }
  // Immediate flush if buffer is getting huge (avoid memory blow-up under burst)
  if (_logBuffer.length >= LOG_FLUSH_MAX_BATCH) {
    if (_logFlushTimer) { clearTimeout(_logFlushTimer); _logFlushTimer = null; }
    void flushGatewayLogs();
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
  // SML Gateway modes
  if (!model || model === "auto" || model === "sml/auto") return { mode: "auto" };
  if (model === "sml/fast") return { mode: "fast" };
  if (model === "sml/tools") return { mode: "tools" };
  if (model === "sml/thai") return { mode: "thai" };
  if (model === "sml/consensus") return { mode: "consensus" };

  const providerMatch = model.match(/^(thaillm|typhoon|openrouter|kilo|google|groq|cerebras|sambanova|mistral|ollama|github|fireworks|cohere|cloudflare|huggingface|nvidia|chutes|llm7|scaleway|pollinations|ollamacloud|siliconflow|glhf|together|hyperbolic|zai|dashscope|reka)\/(.+)$/);
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
      COALESCE(ex.score_pct, 0) as avg_score, COALESCE(ex.total_latency_ms::float, 9999999) as avg_latency
    FROM models m
    LEFT JOIN (
      SELECT DISTINCT ON (model_id) model_id, score_pct, total_latency_ms
      FROM exam_attempts WHERE score_pct >= 50
      ORDER BY model_id, started_at DESC
    ) ex ON m.id = ex.model_id
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
  benchmarkCategory?: string,
  estTokens?: number
): Promise<ModelRow[]> {
  const sql = getSqlClient();

  if (mode === "fast") {
    const visionFilter = caps.hasImages ? "AND m.supports_vision = 1" : "";
    const fastRows = await sql.unsafe(`
      SELECT
        m.id, m.provider, m.model_id, m.supports_tools, m.supports_vision, m.tier, m.context_length,
        ex.score_pct as avg_score,
        COALESCE(rs.avg_lat_real, ex.total_latency_ms::float, 9999999) as avg_latency,
        h.status as health_status,
        h.cooldown_until
      FROM models m
      INNER JOIN (
        SELECT DISTINCT ON (model_id) model_id, score_pct, total_latency_ms
        FROM exam_attempts WHERE score_pct >= 50
        ORDER BY model_id, started_at DESC
      ) ex ON m.id = ex.model_id
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
      ORDER BY
        CASE WHEN m.provider = 'ollama' THEN 1 ELSE 0 END ASC,
        COALESCE(rs.avg_lat_real, ex.total_latency_ms::float, 9999999) ASC,
        ex.score_pct DESC
    `) as ModelRow[];
    return fastRows;
  }

  if (mode === "tools") {
    return getAvailableModels({ ...caps, hasTools: true }, benchmarkCategory, estTokens);
  }

  return getAvailableModels(caps, benchmarkCategory, estTokens);
}

// In-memory cache: (provider:model_id) → supports_reasoning flag (60s TTL).
// Avoids a DB hit on every chat request while still reflecting re-scans.
const reasoningCache = new Map<string, { v: boolean; exp: number }>();
async function lookupReasoning(provider: string, modelId: string): Promise<boolean> {
  const key = `${provider}:${modelId}`;
  const now = Date.now();
  const hit = reasoningCache.get(key);
  if (hit && hit.exp > now) return hit.v;
  try {
    const sql = getSqlClient();
    const rows = await sql<{ supports_reasoning: number | null }[]>`
      SELECT supports_reasoning FROM models WHERE provider = ${provider} AND model_id = ${modelId} LIMIT 1
    `;
    const v = rows[0]?.supports_reasoning === 1;
    reasoningCache.set(key, { v, exp: now + 60_000 });
    return v;
  } catch {
    return false;
  }
}

async function forwardToProvider(
  provider: string,
  actualModelId: string,
  body: Record<string, unknown>,
  stream: boolean,
  externalSignal?: AbortSignal,
  opts: { supportsReasoning?: boolean } = {},
): Promise<Response> {
  const url = resolveProviderUrl(provider);
  if (!url) throw new Error(`Unknown provider: ${provider}`);

  const apiKey = getNextApiKey(provider);
  if (!apiKey) throw new Error(`No API key for provider: ${provider}`);

  // Auto-detect reasoning flag if caller didn't supply it
  const supportsReasoning = opts.supportsReasoning ?? await lookupReasoning(provider, actualModelId);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const auth = resolveProviderAuth(provider);
  if (auth.scheme === "apikey-header") {
    headers[auth.headerName] = apiKey;
  } else if (auth.scheme !== "none") {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://smlgateway.ai";
    headers["X-Title"] = "SMLGateway Gateway";
  }

  const requestBody: Record<string, unknown> = { ...body, model: actualModelId };

  // Auto-enable thinking for reasoning-capable models — unless client already
  // set reasoning/enable_thinking explicitly (opt-out via header or body).
  const optOut = requestBody.reasoning === false ||
                 requestBody.enable_thinking === false ||
                 requestBody["x-sml-disable-thinking"] === true;
  const alreadySet = requestBody.reasoning !== undefined || requestBody.enable_thinking !== undefined;
  if (supportsReasoning && !alreadySet && !optOut) {
    requestBody.reasoning = { effort: "medium" };
    requestBody.enable_thinking = true;
  }
  delete requestBody["x-sml-disable-thinking"];

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

  // Per-attempt timeout — non-stream only
  // Streaming requests MUST NOT have a hard timeout — they're bound by
  // TOTAL_TIMEOUT_MS in the caller, and the client controls abort via externalSignal
  const bodySize = JSON.stringify(body).length;
  let signal: AbortSignal | undefined = externalSignal;
  if (!stream) {
    let timeoutMs: number;
    if (provider === "ollama") {
      timeoutMs = 30_000;
    } else if (bodySize > 40_000) {
      timeoutMs = 60_000;
    } else if (bodySize > 20_000) {
      timeoutMs = 35_000;
    } else if (bodySize > 10_000) {
      timeoutMs = 20_000;
    } else {
      timeoutMs = 12_000;
    }
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    signal = externalSignal ? AbortSignal.any([timeoutSignal, externalSignal]) : timeoutSignal;
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
    signal,
    // @ts-expect-error undici dispatcher not in standard fetch types
    dispatcher: upstreamAgent,
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
  contenders: ModelRow[],
  body: Record<string, unknown>,
  isStream: boolean
): Promise<{ response: Response; winner: ModelRow; winnerIdx: number }> {
  // Streaming hedge: race on first chunk received, not full response.
  // Whichever provider delivers the first byte wins; loser is aborted.
  // The winning stream is reconstructed (first chunk + remaining reader)
  // into a fresh ReadableStream so the caller can pipe it to the client.
  if (isStream) return streamHedgeRace(contenders, body);

  const controllers = contenders.map(() => new AbortController());

  const attempts = contenders.map((candidate, idx) =>
    forwardToProvider(candidate.provider, candidate.model_id, body, isStream, controllers[idx].signal)
      .then(res => {
        if (res.ok) return { response: res, winner: candidate, winnerIdx: idx };
        throw new Error(`HTTP ${res.status}`);
      })
  );

  const result = await Promise.any(attempts);
  controllers.forEach((c, i) => { if (i !== result.winnerIdx) c.abort(); });
  return result;
}

async function streamHedgeRace(
  contenders: ModelRow[],
  body: Record<string, unknown>,
): Promise<{ response: Response; winner: ModelRow; winnerIdx: number }> {
  const controllers = contenders.map(() => new AbortController());

  // Race on first chunk: each candidate awaits its HTTP response, then awaits
  // the first reader.read(). First to deliver real bytes wins.
  const attempts = contenders.map(async (candidate, idx) => {
    const res = await forwardToProvider(candidate.provider, candidate.model_id, body, true, controllers[idx].signal);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!res.body) throw new Error("no body");
    const reader = res.body.getReader();
    const first = await reader.read();
    if (first.done) throw new Error("empty stream");
    return { idx, firstChunk: first.value, reader, response: res, winner: candidate };
  });

  const winner = await Promise.any(attempts);
  // Abort losers — let them clean up in the background
  controllers.forEach((c, i) => { if (i !== winner.idx) { try { c.abort(); } catch { /* ignore */ } } });

  // Stitch (firstChunk + remaining reader) into a new ReadableStream that the
  // caller can hand to NextResponse — preserves SSE framing transparently.
  const stitched = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(winner.firstChunk);
        while (true) {
          const { value, done } = await winner.reader.read();
          if (done) break;
          if (value) controller.enqueue(value);
        }
      } catch (err) {
        controller.error(err);
        return;
      }
      controller.close();
    },
    cancel() {
      try { winner.reader.cancel(); } catch { /* ignore */ }
    },
  });

  // Preserve provider response headers (Content-Type, X-RateLimit-*, etc.)
  const proxiedRes = new Response(stitched, {
    status: winner.response.status,
    statusText: winner.response.statusText,
    headers: winner.response.headers,
  });
  return { response: proxiedRes, winner: winner.winner, winnerIdx: winner.idx };
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
      // @ts-expect-error undici dispatcher not in standard fetch types
      dispatcher: upstreamAgent,
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

let _staleModelsCleanedUp = false;

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

    // Prompt library lookup — body.prompt = "saved-prompt-name" prepends
    // stored system prompt to the messages array. Silent no-op if not found.
    if (typeof body.prompt === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(body.prompt)) {
      try {
        const sql = getSqlClient();
        const rows = await sql<Array<{ content: string }>>`
          SELECT content FROM prompts WHERE name = ${body.prompt}
        `;
        if (rows.length > 0) {
          const existing = body.messages as Array<{ role: string; content: unknown }>;
          const hasSystem = existing.length > 0 && existing[0].role === "system";
          body.messages = hasSystem
            ? [{ role: "system", content: rows[0].content + "\n\n" + String(existing[0].content) }, ...existing.slice(1)]
            : [{ role: "system", content: rows[0].content }, ...existing];
          sql`UPDATE prompts SET use_count = use_count + 1 WHERE name = ${body.prompt}`.catch(() => {});
        }
      } catch { /* non-critical */ }
    }

    const modelField = (body.model as string) || "auto";
    const isStream = body.stream === true;
    const caps = detectRequestCapabilities(body);
    const _reqTime = Date.now();
    const _reqMsg = redactForLog(extractUserMessage(body));
    const _reqId = Math.random().toString(36).slice(2, 8); // short id สำหรับไล่ log
    const _msgCount = Array.isArray(body.messages) ? (body.messages as unknown[]).length : 0;
    const _estTokensInit = estimateTokens(body);
    const _imgCount = caps.hasImages ? ((body.messages as Array<{content: unknown}>).reduce((n, m) => n + (Array.isArray(m.content) ? (m.content as Array<{type: string}>).filter(p => p.type === "image_url").length : 0), 0)) : 0;
    const _toolCount = Array.isArray(body.tools) ? (body.tools as unknown[]).length : 0;
    console.log(`[REQ:${_reqId}] ${modelField} | stream=${isStream} | img=${_imgCount} | tools=${_toolCount} | msgs=${_msgCount} | est=${_estTokensInit}tok | "${_reqMsg}"`);

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
    // Soft rate limit: never hard-block, but emit X-Resceo-Backoff: true as a
    // voluntary backoff hint once the client exceeds a low soft threshold.
    // Upstream providers still impose hard ceilings (~5 calls/min) — this header
    // lets well-behaved clients slow down before they hit upstream 429s.
    const HARD_LIMIT = 100_000;
    const SOFT_LIMIT = Number(process.env.GATEWAY_SOFT_RATE_LIMIT ?? "4");
    const rl = await checkRateLimit(`chat:${ip}`, HARD_LIMIT, 60);
    const softBackoff = (HARD_LIMIT - rl.remaining) > SOFT_LIMIT;

    // Fix B: Fire-and-forget — put known-stale Cerebras models on 365-day cooldown
    if (!_staleModelsCleanedUp) {
      _staleModelsCleanedUp = true;
      getSqlClient()`
        INSERT INTO health_logs (model_id, status, error, cooldown_until, checked_at)
        SELECT m.id, 'available', 'stale model removed from API', now() + interval '365 days', now()
        FROM models m
        WHERE m.provider = 'cerebras'
          AND m.model_id IN ('gpt-oss-120b', 'zai-glm-4.7', 'qwen-3-32b-fast-scheduler-offline')
          AND NOT EXISTS (
            SELECT 1 FROM health_logs h WHERE h.model_id = m.id AND h.cooldown_until > now() + interval '100 days'
          )
      `.catch(() => {});
    }

    // Improvement C: response cache check (non-stream, low-temperature, no tools)
    const cachedHit = await getCachedResponse(body);
    if (cachedHit) {
      console.log(`[CACHE-HIT] ${cachedHit.provider}/${cachedHit.model}`);
      const cacheHeaders = new Headers();
      cacheHeaders.set("Content-Type", "application/json");
      cacheHeaders.set("X-SMLGateway-Provider", cachedHit.provider);
      cacheHeaders.set("X-SMLGateway-Model", cachedHit.model);
      cacheHeaders.set("X-SMLGateway-Cache", "HIT");
      cacheHeaders.set("X-SMLGateway-Request-Id", _reqId);
      if (softBackoff) cacheHeaders.set("X-Resceo-Backoff", "true");
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

    const estInputTokens = estimateTokens(body);
    const promptCategory = detectPromptCategory(extractUserMessage(body) ?? "");
    console.log(`[CAT:${_reqId}] ${promptCategory}`);

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
            "sml/consensus", best.model.model_id, best.model.provider, 200, totalLatency,
            usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0, null, userMsg,
            `[consensus: ${valid.map((v) => v.model.provider + "/" + v.model.model_id).join(", ")}] ${best.content.slice(0, 300)}`,
            _reqId, ip
          );

          const headers = new Headers();
          headers.set("Content-Type", "application/json");
          headers.set("X-SMLGateway-Provider", best.model.provider);
          headers.set("X-SMLGateway-Model", best.model.model_id);
          headers.set("X-SMLGateway-Consensus", valid.map((v) => `${v.model.provider}/${v.model.model_id}(${v.content.length}chars/${v.latency}ms)`).join(", "));
          headers.set("X-SMLGateway-Request-Id", _reqId);
          if (softBackoff) headers.set("X-Resceo-Backoff", "true");
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
      // Parse rate limit headers regardless of success/fail
      const hdrLimit = parseLimitHeaders(response.headers);
      if (hdrLimit) recordLimit(provider!, modelId!, hdrLimit).catch(() => {});

      if (!response.ok && isRetryableStatus(response.status)) {
        const errText = await response.text();
        if (response.status === 429) {
          const parsed429 = parseLimitError(errText);
          if (parsed429) recordLimit(provider!, modelId!, parsed429).catch(() => {});
        }
        return openAIError(response.status, { message: errText || `Provider ${provider} returned ${response.status}` });
      }
      console.log(`[RES:${_reqId}] ${response.status} | ${provider}/${modelId} | ${Date.now() - _reqTime}ms | direct`);
      return buildProxiedResponse(response, provider!, modelId!, isStream, estInputTokens, softBackoff, _reqId);
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
      console.log(`[RES:${_reqId}] ${response.status} | ${row.provider}/${row.model_id} | ${Date.now() - _reqTime}ms | match`);
      return buildProxiedResponse(response, row.provider, row.model_id, isStream, estInputTokens, softBackoff, _reqId);
    }

    // ---- Smart routing: auto / fast / tools / thai ----
    const benchmarkCategory = caps.hasImages ? "vision" : promptCategory;
    const candidates = await selectModelsByMode(parsed.mode, caps, benchmarkCategory, estInputTokens);
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
      // Fallback: the exam worker is running in parallel, and DISTINCT ON picks
      // the latest attempt per model. A single bad worker round can flip all
      // rows to score_pct=0 for a ~second, and we don't want real traffic to
      // 503 through that window. Fall back to a permissive list (no exam
      // filter) so the request still gets served; the per-request retry loop
      // below will weed out actually-broken models.
      console.log(`[FALLBACK:${_reqId}] selectModelsByMode returned 0 — using getAllModelsIncludingCooldown`);
      finalCandidates = await getAllModelsIncludingCooldown(caps);
    }
    if (finalCandidates.length === 0) {
      const reason = "ไม่มี model ที่ผ่านสอบ — รอ worker exam cycle";
      await logGateway(modelField, null, null, 503, Date.now() - _reqTime, 0, 0, reason, extractUserMessage(body), null, _reqId, ip);
      console.log(`[RES:${_reqId}] 503 | no passed models | ${reason}`);
      return openAIError(503, { message: reason });
    }

    const MAX_RETRIES = 25;
    let lastError = "";
    let lastProvider: string | null = null;
    let lastModelId: string | null = null;
    const startTime = Date.now();
    const userMsg = extractUserMessage(body);
    const triedProviders = new Set<string>();
    const blockedProviders = new Set<string>();

    // กรอง provider ที่ไม่มี API key ออก (ใช้งานไม่ได้แน่นอน)
    finalCandidates = finalCandidates.filter(c => hasProviderKey(c.provider));
    // กรอง provider ที่ผู้ใช้ปิดเองผ่าน UI
    finalCandidates = finalCandidates.filter(c => isProviderEnabledSync(c.provider));

    // ── Category boost: ดัน model ที่เก่ง category นี้ขึ้นบน ──
    const learningCategory = detectCategory(
      extractUserMessage(body) ?? "",
      caps.hasTools,
      caps.hasImages,
      estInputTokens
    );
    const categoryWinnerIds = await getCategoryWinners(learningCategory, 5);
    if (categoryWinnerIds.length > 0) {
      const winnerSet = new Set(categoryWinnerIds);
      const winners = finalCandidates.filter(c => winnerSet.has(c.id));
      const others = finalCandidates.filter(c => !winnerSet.has(c.id));
      finalCandidates = [...winners, ...others];
      if (winners.length > 0) {
        console.log(`[CATEGORY-BOOST:${_reqId}] "${learningCategory}" → ${winners.length} winners: ${winners.slice(0,3).map(w => w.provider+'/'+w.model_id).join(', ')}`);
      }
    }

    // ── Category-specific filtering: เลือก model ที่เก่งด้านนี้ ──
    const examCat = ROUTING_TO_EXAM_CAT[learningCategory] ?? "general";
    if (examCat !== "general" && finalCandidates.length > 3) {
      try {
        const sql = getSqlClient();
        const catScores = await sql<{ model_id: string; score_pct: number }[]>`
          SELECT model_id::text, score_pct FROM model_category_scores
          WHERE category = ${examCat} AND score_pct >= 60
        `;
        const catScoreMap = new Map(catScores.map(r => [r.model_id, r.score_pct]));
        const catFiltered = finalCandidates.filter(c => catScoreMap.has(String(c.id)));
        if (catFiltered.length >= 2) {
          const dropped = finalCandidates.length - catFiltered.length;
          if (dropped > 0) console.log(`[CAT-FILTER:${_reqId}] ${learningCategory}→${examCat}: kept ${catFiltered.length}, dropped ${dropped} models with <60% in ${examCat}`);
          finalCandidates = catFiltered;
        }
      } catch (e) {
        console.log(`[CAT-FILTER:${_reqId}] error: ${e}`);
      }
    }

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
      // context_length = 0 หรือ null → ไม่รู้ขนาด ถือว่าไม่ปลอดภัย ข้าม
      if (!c.context_length || c.context_length === 0) {
        console.log(`[SIZE-SKIP] ${c.provider}/${c.model_id} unknown context (0) — required ${requiredContext}`);
        return false;
      }
      if (c.context_length >= requiredContext) return true;
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

    // U2: Context-aware provider filter for large requests
    if (estTokens > 20_000) {
      const ctxMin = Math.ceil(estTokens * 1.5);
      const ctxFiltered = finalCandidates.filter(c => c.context_length > ctxMin);
      if (ctxFiltered.length > 0) {
        finalCandidates = ctxFiltered;
      }
      console.log(`[CTX-FILTER:${_reqId}] kept=${finalCandidates.length} for ${estTokens}tok`);
    }

    // Minimum context filter — model ที่ ctx < 16K ไม่เหมาะกับ conversation ที่มี history
    const MIN_CTX = 16_000;
    const ctxMinFiltered = finalCandidates.filter(c => (c.context_length ?? 0) >= MIN_CTX);
    if (ctxMinFiltered.length > 0) {
      const dropped = finalCandidates.length - ctxMinFiltered.length;
      if (dropped > 0) console.log(`[MIN-CTX:${_reqId}] dropped ${dropped} models with ctx<${MIN_CTX}`);
      finalCandidates = ctxMinFiltered;
    }

    // Latency cap — model ที่ exam latency > 30s ช้าเกินใช้งานจริง
    const MAX_EXAM_LATENCY = 30_000;
    const latFiltered = finalCandidates.filter(c => (c.avg_latency ?? 0) <= MAX_EXAM_LATENCY || (c.avg_latency ?? 0) === 0);
    if (latFiltered.length > 0) {
      const dropped = finalCandidates.length - latFiltered.length;
      if (dropped > 0) console.log(`[LAT-CAP:${_reqId}] dropped ${dropped} models with exam latency>${MAX_EXAM_LATENCY}ms`);
      finalCandidates = latFiltered;
    }

    // Vision filter — ตัด vision-specialized models ออกเมื่อ request ไม่มีรูป
    // (vision models ช้า 20-30s สำหรับ text-only request)
    if (!caps.hasImages && finalCandidates.length > 3) {
      const noVision = finalCandidates.filter(c => !/-vision[-\d]/i.test(c.model_id));
      if (noVision.length >= 3) {
        const dropped = finalCandidates.length - noVision.length;
        if (dropped > 0) console.log(`[VISION-FILTER:${_reqId}] dropped ${dropped} vision-only models (no image in request)`);
        finalCandidates = noVision;
      }
    }

    // ── Dev options: prefer / exclude / max_latency / strategy ─────────────
    // From body.extra or X- headers (both supported, body wins)
    // - prefer: string[] provider names → rank first
    // - exclude: string[] provider names → drop
    // - max_latency_ms: number → drop models whose avg_latency > limit
    // - strategy: "fastest" | "strongest" | "cheapest" — preset optimization hints
    const extra = (body as Record<string, unknown>).extra as Record<string, unknown> | undefined;
    const parseCsv = (v: unknown): string[] =>
      (typeof v === "string" ? v.split(",") : Array.isArray(v) ? (v as unknown[]).map(String) : [])
        .map(s => s.trim().toLowerCase()).filter(Boolean);
    const prefer = parseCsv(extra?.prefer ?? req.headers.get("x-smlgateway-prefer"));
    const exclude = parseCsv(extra?.exclude ?? req.headers.get("x-smlgateway-exclude"));
    const maxLatencyMs = Number(extra?.max_latency_ms ?? req.headers.get("x-smlgateway-max-latency") ?? 0);
    const strategy = String(extra?.strategy ?? req.headers.get("x-smlgateway-strategy") ?? "").toLowerCase();

    if (exclude.length > 0) {
      const before = finalCandidates.length;
      finalCandidates = finalCandidates.filter(c => !exclude.includes(c.provider.toLowerCase()));
      console.log(`[DEV-EXCLUDE:${_reqId}] dropped ${before - finalCandidates.length} models from [${exclude.join(",")}]`);
    }

    if (maxLatencyMs > 0) {
      const before = finalCandidates.length;
      finalCandidates = finalCandidates.filter(c => (c.avg_latency ?? 0) === 0 || (c.avg_latency ?? 0) <= maxLatencyMs);
      if (before - finalCandidates.length > 0) {
        console.log(`[DEV-LAT:${_reqId}] dropped ${before - finalCandidates.length} models with avg_latency>${maxLatencyMs}ms`);
      }
    }

    if (prefer.length > 0) {
      const preferred = finalCandidates.filter(c => prefer.includes(c.provider.toLowerCase()));
      const rest = finalCandidates.filter(c => !prefer.includes(c.provider.toLowerCase()));
      finalCandidates = [...preferred, ...rest];
      console.log(`[DEV-PREFER:${_reqId}] ranked ${preferred.length} preferred models first: [${prefer.join(",")}]`);
    }

    if (strategy === "fastest") {
      // sort by avg_latency ASC (models with data first)
      finalCandidates = [...finalCandidates].sort((a, b) => {
        const al = a.avg_latency ?? Number.MAX_SAFE_INTEGER;
        const bl = b.avg_latency ?? Number.MAX_SAFE_INTEGER;
        return al - bl;
      });
      console.log(`[DEV-STRATEGY:${_reqId}] fastest — top: ${finalCandidates.slice(0,3).map(c => `${c.provider}/${c.model_id}(${c.avg_latency ?? "?"}ms)`).join(", ")}`);
    } else if (strategy === "strongest") {
      // prefer larger tier + bigger context
      const tierRank: Record<string, number> = { xlarge: 4, large: 3, medium: 2, small: 1 };
      finalCandidates = [...finalCandidates].sort((a, b) => {
        const at = tierRank[a.tier] ?? 0;
        const bt = tierRank[b.tier] ?? 0;
        if (bt !== at) return bt - at;
        return (b.context_length ?? 0) - (a.context_length ?? 0);
      });
      console.log(`[DEV-STRATEGY:${_reqId}] strongest — top: ${finalCandidates.slice(0,3).map(c => `${c.provider}/${c.model_id}(${c.tier}/${c.context_length})`).join(", ")}`);
    }

    // ─── Provider-first selection ─────────────────────────────────────────
    // ขั้นตอน:
    //   1. ตัดทิ้ง model ที่เพิ่ง fail ติดกัน (isRecentlyDead)
    //   2. Group ตาม provider
    //   3. จัดอันดับ provider ด้วย live success rate + benchmark score - latency
    //   4. ใน provider แต่ละตัว จัดอันดับ model ด้วย live score + benchmark
    //   5. Flatten: [best provider's models..., next provider's models..., ...]
    //      (ไม่ round-robin — ถ้า provider ไหนดี ลอง model ดีๆ ของมันให้หมดก่อน)
    const preFilteredCandidates = finalCandidates.filter(
      c => !isRecentlyDead(c.provider, c.model_id)
    );
    const poolCandidates = preFilteredCandidates.length > 0 ? preFilteredCandidates : finalCandidates;

    const byProvider: Record<string, typeof finalCandidates> = {};
    for (const c of poolCandidates) {
      (byProvider[c.provider] ??= []).push(c);
    }

    const providerRanking = await Promise.all(
      Object.entries(byProvider).map(async ([prov, models]) => {
        const liveP = getProviderScore(prov);
        const avgBenchLat = models.reduce((s, m) => s + (m.avg_latency ?? 9999999), 0) / models.length;
        const avgBenchScore = models.reduce((s, m) => s + (m.avg_score ?? 0), 0) / models.length;
        const repScores = await Promise.all(models.map(m => getReputationScore(m.id)));
        const avgRep = repScores.reduce((s, r) => s + r, 0) / repScores.length;

        // Weight: live success rate + exam score (ถ่วงเท่ากัน) + inverse latency
        // exam_score สำคัญมาก — model 93% ต้องชนะ model 86% แม้จะช้ากว่านิดหน่อย
        // Ollama ดันไปท้ายเสมอ (local ช้า reserve เป็น fallback)
        let weight: number;
        if (prov === "ollama") {
          weight = -Infinity;
        } else {
          weight =
            liveP.successRate * 50_000 +          // live success rate (ลดจาก 100K → 50K)
            avgBenchScore * 3_000 * (avgRep / 100) +  // exam score (เพิ่ม 3x จาก 1K → 3K)
            Math.min(liveP.avgLatency, avgBenchLat) / -10; // latency penalty
        }
        return { prov, models, weight, liveScore: liveP };
      })
    );
    providerRanking.sort((a, b) => b.weight - a.weight);

    {
      const rankLog = providerRanking.slice(0, 5).map(r =>
        `${r.prov}(${(r.liveScore.successRate * 100).toFixed(0)}%/${Math.round(r.liveScore.avgLatency)}ms/n=${r.liveScore.samples})`
      ).join(" > ");
      console.log(`[PROVIDER-RANK:${_reqId}] ${rankLog}`);
      console.log(`[CANDIDATES:${_reqId}] ${finalCandidates.length} candidates | top5: ${finalCandidates.slice(0,5).map(c => `${c.provider}/${c.model_id}(ctx=${c.context_length})`).join(", ")}`);
    }

    // ภายในแต่ละ provider เรียง model ตาม live-score + benchmark
    const spreadCandidates: typeof finalCandidates = [];
    const seenIds = new Set<string>();
    for (const { models } of providerRanking) {
      const sortedModels = [...models].sort((a, b) => {
        const la = getModelScore(a.id);
        const lb = getModelScore(b.id);
        const scoreA = la.successRate * 5_000 + (a.avg_score ?? 0) * 300 - Math.min(la.avgLatency, a.avg_latency ?? 9999) / 100;
        const scoreB = lb.successRate * 5_000 + (b.avg_score ?? 0) * 300 - Math.min(lb.avgLatency, b.avg_latency ?? 9999) / 100;
        return scoreB - scoreA;
      });
      for (const m of sortedModels) {
        if (!seenIds.has(m.id)) { seenIds.add(m.id); spreadCandidates.push(m); }
      }
    }

    // Sticky routing: same (ip, category) tuple that succeeded in last 30s?
    // Bump that model to position 0 so warm TCP socket + upstream KV cache
    // give us a head-start. Non-authoritative — still walks skip checks.
    const stickyHit = ip ? getSticky(ip, promptCategory) : null;
    if (stickyHit) {
      const stickyIdx = spreadCandidates.findIndex(c =>
        c.provider === stickyHit.provider && c.model_id === stickyHit.modelId);
      if (stickyIdx > 0) {
        const [pinned] = spreadCandidates.splice(stickyIdx, 1);
        spreadCandidates.unshift(pinned);
        if (process.env.LOG_LEVEL === "debug") console.log(`[STICKY:${_reqId}] pinned ${stickyHit.provider}/${stickyHit.modelId} (from idx ${stickyIdx})`);
      }
    }

    if (process.env.LOG_LEVEL === "debug") console.log(`[DEBUG] spread=${spreadCandidates.length} top5=[${spreadCandidates.slice(0,5).map(c=>c.provider+'/'+c.model_id).join(', ')}]`);

    // ถ้าไม่มี candidate เหลือเลยหลังผ่าน filter — ตอบ 503 พร้อม log ที่อ่านออก
    if (spreadCandidates.length === 0) {
      const reason = caps.hasImages
        ? "ไม่มี vision model พร้อมใช้งาน"
        : caps.hasTools
          ? "ไม่มี tool-calling model พร้อมใช้งาน"
          : "ทุก model ติด cooldown หรือขาด API key";
      const latency = Date.now() - startTime;
      await logGateway(modelField, null, null, 503, latency, 0, 0, reason, userMsg, null, _reqId, ip);
      console.log(`[RES:${_reqId}] 503 | no candidates | ${reason}`);
      return openAIError(503, { message: reason });
    }

    // Total retry budget — ขยายตาม estTokens (U2: aggressive overhaul)
    const TOTAL_TIMEOUT_MS =
      estTokens > 40_000 ? 120_000 :
      estTokens > 20_000 ? 90_000  :
      estTokens > 10_000 ? 60_000  :
      30_000;

    // Improvement A (U2): parallel hedge top-3 cloud candidates (skip for stream / tools)
    // Each contender must come from a DIFFERENT provider — sending concurrent requests
    // to the same provider triggers rate-limiting (verified: 3x groq → all timeout).
    // Only scan the first 10 candidates to keep hedgeStartIdx predictable.
    let hedgeStartIdx = 0;
    const seenProviders = new Set<string>();
    const hedgeContenders: typeof spreadCandidates = [];
    let lastHedgeIdx = -1;
    for (let hi = 0; hi < Math.min(10, spreadCandidates.length); hi++) {
      const c = spreadCandidates[hi];
      if (c.provider === "ollama") break;
      if (!seenProviders.has(c.provider)) {
        seenProviders.add(c.provider);
        hedgeContenders.push(c);
        lastHedgeIdx = hi;
        if (hedgeContenders.length === 3) break;
      }
    }
    // Sequential starts AFTER the last hedged position so we don't re-run the hedge slot
    hedgeStartIdx = lastHedgeIdx + 1;
    const hedgeCount = hedgeContenders.length;
    // Hedge gate: now allows isStream=true — streamHedgeRace handles the
    // race-on-first-byte path and stitches the winning ReadableStream.
    const canHedge =
      !caps.hasTools &&
      estTokens <= 20_000 &&
      hedgeCount >= 2;
    // Only skip hedged candidates when hedge actually runs — otherwise start from 0
    if (!canHedge) hedgeStartIdx = 0;
    if (canHedge) {
      try {
        const hedgeResult = await hedgeRace(hedgeContenders, body, isStream);
        const { response: hedgeResp, winner, winnerIdx } = hedgeResult;
        const losers = hedgeContenders.filter((_, i) => i !== winnerIdx);
        const latency = Date.now() - startTime;
        console.log(`[HEDGE-WIN:${_reqId}] ${winner.provider}/${winner.model_id} vs [${losers.map(l => `${l.provider}/${l.model_id}`).join(", ")}] | ${latency}ms`);
        // Record winner as success, loser as neutral (cancelled)
        await recordProviderSuccessMem(winner.provider, winner.model_id);
        if (ip) setSticky(ip, promptCategory, winner.provider, winner.model_id);

        // Streaming hedge: stitched stream is already a fresh ReadableStream
        // from streamHedgeRace — just decorate with our headers and return.
        // Token usage / quality checks aren't possible without consuming the
        // stream, so we record minimal stats (success + latency) and skip
        // the post-gen Thai check / response cache for this path.
        if (isStream) {
          const streamHeaders = new Headers(hedgeResp.headers);
          streamHeaders.set("X-SMLGateway-Provider", winner.provider);
          streamHeaders.set("X-SMLGateway-Model", winner.model_id);
          streamHeaders.set("X-SMLGateway-Hedge", "true");
          streamHeaders.set("X-SMLGateway-Request-Id", _reqId);
          if (softBackoff) streamHeaders.set("X-Resceo-Backoff", "true");
          streamHeaders.set("Access-Control-Allow-Origin", "*");
          await logGateway(modelField, winner.model_id, winner.provider, 200, latency, 0, 0, null, userMsg, null, _reqId, ip);
          await recordRoutingResult(winner.id, winner.provider, promptCategory, true, latency);
          recordOutcome(winner.provider, winner.model_id, true, latency);
          recordBattleEvent(outcomeFromLatency(latency, true)).catch(() => {});
          console.log(`[RES:${_reqId}] 200 | ${winner.provider}/${winner.model_id} | ${latency}ms | hedge-stream`);
          return new Response(hedgeResp.body, { status: 200, headers: streamHeaders });
        }

        // Parse and return the hedge winner response (non-stream)
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
            // Reset to 0 so sequential retry doesn't skip intermediate same-provider candidates
            // (hedge picks 1-per-provider across spread indices, leaving gaps)
            hedgeStartIdx = 0;
          } else {
            if (content && THINK_TAG_RE.test(content)) {
              content = cleanResponseContent(content);
              if (json.choices?.[0]?.message) json.choices[0].message.content = content;
            }
            const usage = json.usage;
            await logGateway(modelField, winner.model_id, winner.provider, 200, latency,
              usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0, null, userMsg, content?.slice(0, 500) ?? null,
              _reqId, ip);
            await recordRoutingResult(winner.id, winner.provider, promptCategory, true, latency);
            recordOutcome(winner.provider, winner.model_id, true, latency);
            recordOutcomeLearning({
              modelId: winner.id, provider: winner.provider,
              tokens: estInputTokens, latencyMs: latency, success: true,
              hasTools: caps.hasTools, hasImages: caps.hasImages,
              userMessage: extractUserMessage(body) ?? "",
            }).catch(() => {});
            if (promptCategory === "thai" && content) {
              recordThaiQualityPenalty(winner.id, winner.provider, extractUserMessage(body) ?? "", content)
                .then((demoted) => {
                  if (demoted) console.log(`[THAI-DEMOTE] ${winner.provider}/${winner.model_id} failed post-gen Thai check`);
                })
                .catch(() => {});
            }
            const slowThr = slowThresholdMs(estTokens);
            if (latency > slowThr) {
              await logCooldown(winner.id, `slow hedge winner: ${latency}ms > ${slowThr}ms threshold`, 0, 2);
              recordOutcome(winner.provider, winner.model_id, false, latency);
              console.log(`[SLOW-COOLDOWN] ${winner.provider}/${winner.model_id} ${latency}ms > ${slowThr}ms → 2min cooldown`);
            }
            await trackTokenUsage(winner.provider, winner.model_id, usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0);
            // P4: record token consumption for TPM tracking
            const hedgeTotalTokens = (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0);
            recordTokenConsumption(winner.provider, winner.model_id, hedgeTotalTokens).catch(() => {});
            recordBattleEvent(outcomeFromLatency(latency, true)).catch(() => { /* cosmetic */ });
            if (content) {
              setCachedResponse(body, { content, provider: winner.provider, model: winner.model_id }).catch(() => { /* non-critical */ });
            }
            const hedgeHeaders = new Headers();
            hedgeHeaders.set("Content-Type", "application/json");
            hedgeHeaders.set("X-SMLGateway-Provider", winner.provider);
            hedgeHeaders.set("X-SMLGateway-Model", winner.model_id);
            hedgeHeaders.set("X-SMLGateway-Hedge", "true");
            hedgeHeaders.set("X-SMLGateway-Request-Id", _reqId);
            if (softBackoff) hedgeHeaders.set("X-Resceo-Backoff", "true");
            hedgeHeaders.set("Access-Control-Allow-Origin", "*");
            const _hpt = usage?.prompt_tokens ?? 0; const _hct = usage?.completion_tokens ?? 0;
            const _htc = Array.isArray(json.choices?.[0]?.message?.tool_calls) ? json.choices[0].message.tool_calls.length : 0;
            const _hans = content ? redactForLog(content) : (_htc > 0 ? `[tool_call×${_htc}]` : "-");
            console.log(`[RES:${_reqId}] 200 | ${winner.provider}/${winner.model_id} | ${latency}ms | hedge | pt=${_hpt} ct=${_hct} tc=${_htc} | Q:"${_reqMsg}" A:"${_hans}"`);
            return new Response(JSON.stringify(json), { status: 200, headers: hedgeHeaders });
          }
        } catch {
          // JSON parse failed — fall through to sequential
          hedgeStartIdx = 0;
        }
      } catch {
        const latency = Date.now() - startTime;
        console.log(`[HEDGE-LOSS:${_reqId}] all top-${hedgeCount} failed | ${latency}ms — continuing sequential`);
        hedgeStartIdx = 0;
        await Promise.all(
          hedgeContenders.flatMap(c => [recordProviderFailureMem(c.provider), recordCircuitFailure(c.provider, c.model_id)])
        );
      }
    }

    // Track skipped candidates for possible second-pass retry
    const skippedCandidates: typeof spreadCandidates = [];
    const skipReasons: string[] = [];

    for (let i = hedgeStartIdx, tried = 0; i < spreadCandidates.length && tried < MAX_RETRIES; i++) {
      if (Date.now() - startTime > TOTAL_TIMEOUT_MS) {
        console.log(`[TIMEOUT] Total retry time exceeded ${TOTAL_TIMEOUT_MS}ms — stopping`);
        break;
      }
      const candidate = spreadCandidates[i];
      // `let` so a speculative-hedge win can swap these to the winner's vars
      // without threading effective-X names through the entire success path.
      let { provider, model_id: actualModelId, id: dbModelId } = candidate;
      if (blockedProviders.has(provider)) { skippedCandidates.push(candidate); skipReasons.push(`${provider}/${actualModelId}:blocked`); continue; }

      // ── Run independent skip-checks in parallel ─────────────────────
      // Each check is a Redis/DB lookup; running them serially burned
      // 7×~5-15ms = up to 100ms per candidate. Promise.all collapses to
      // ~max(15ms). First check that returns "skip" wins (deterministic
      // priority list mirrors the original serial order).
      const estProjected = estTokens + 2000;
      const wantOllamaCheck = provider === "ollama";
      const hasCloudAlt = wantOllamaCheck && spreadCandidates.slice(i + 1).some(c => c.provider !== "ollama");
      const hasCloudLeft = wantOllamaCheck && caps.hasTools && spreadCandidates.slice(i).some(c => c.provider !== "ollama" && !blockedProviders.has(c.provider));
      const wantUnhealthyCheck = caps.hasTools || caps.hasImages;

      const [
        cooledDown,
        circuitOpen,
        ollamaLoaded,
        unhealthyCheck,
        tpmHeadroom,
        fitCheck,
        capCheck,
      ] = await Promise.all([
        isProviderCooledDownMem(provider),
        isCircuitOpen(provider, actualModelId),
        wantOllamaCheck && hasCloudAlt ? isOllamaModelLoaded(actualModelId) : Promise.resolve(true),
        wantUnhealthyCheck ? isModelUnhealthyForCategory(dbModelId, learningCategory) : Promise.resolve({ unhealthy: false, reason: "" }),
        hasTpmHeadroom(provider, actualModelId, estProjected),
        canFitRequest(provider, actualModelId, estProjected),
        canHandleTokens(dbModelId, estTokens),
      ]);

      if (cooledDown) { skippedCandidates.push(candidate); skipReasons.push(`${provider}/${actualModelId}:provider-cooldown`); continue; }
      if (circuitOpen) { skippedCandidates.push(candidate); skipReasons.push(`${provider}/${actualModelId}:circuit-open`); console.log(`[CIRCUIT-SKIP] ${provider}/${actualModelId} circuit open`); continue; }
      if (wantOllamaCheck && hasCloudAlt && !ollamaLoaded) {
        skippedCandidates.push(candidate); skipReasons.push(`${provider}/${actualModelId}:cold-ollama`);
        console.log(`[OLLAMA-SKIP] ${actualModelId} not loaded in memory — skipping (cloud alternatives available)`);
        continue;
      }
      if (hasCloudLeft) {
        skippedCandidates.push(candidate); skipReasons.push(`${provider}/${actualModelId}:ollama-no-tools`);
        console.log(`[OLLAMA-SKIP-TOOLS] ${actualModelId} — tools requested, cloud alternatives exist`);
        continue;
      }
      if (wantUnhealthyCheck && unhealthyCheck.unhealthy) {
        skippedCandidates.push(candidate); skipReasons.push(`${provider}/${actualModelId}:unhealthy-${learningCategory}`);
        console.log(`[UNHEALTHY-SKIP:${_reqId}] ${provider}/${actualModelId} ${learningCategory} — ${unhealthyCheck.reason}`);
        continue;
      }
      if (!tpmHeadroom) {
        skippedCandidates.push(candidate); skipReasons.push(`${provider}/${actualModelId}:tpm-exhausted`);
        console.log(`[TPM-EXHAUST-SKIP:${_reqId}] ${provider}/${actualModelId} — est ${estProjected} tok`);
        continue;
      }
      if (!fitCheck.ok) {
        skippedCandidates.push(candidate);
        const tag = fitCheck.reason?.startsWith("TPM hard") || fitCheck.reason?.startsWith("TPD hard") ? "limit-hard" : "limit-exhausted";
        skipReasons.push(`${provider}/${actualModelId}:${tag}`);
        console.log(`[LIMIT-SKIP:${_reqId}] ${provider}/${actualModelId} — ${fitCheck.reason}`);
        continue;
      }
      if (!capCheck.ok) {
        skippedCandidates.push(candidate); skipReasons.push(`${provider}/${actualModelId}:capacity`);
        console.log(`[CAPACITY-SKIP:${_reqId}] ${provider}/${actualModelId} — ${capCheck.reason}`);
        continue;
      }

      // ── ผ่าน skip checks ทั้งหมดแล้ว → นับเป็น actual attempt ──
      tried++;
      triedProviders.add(provider);
      recordProviderAttempt(provider).catch(() => { /* non-critical */ });

      // Check if this attempt is a half-open probe
      let wasProbing = false;
      try {
        const redis = getRedis();
        const cbState = await redis.get(`cb:open:${provider}:${actualModelId}`);
        wasProbing = cbState === "half-open";
      } catch { /* ignore */ }

      // ── Speculative hedge (first sequential attempt only, non-stream) ──
      // If the primary upstream hasn't responded in ~1.5s, start a race with
      // the next viable candidate on a DIFFERENT provider. Whoever responds
      // first wins — the loser gets aborted via AbortController.
      //
      // Only fires when hedge at the top of the handler was skipped (stream
      // or tools path) or fell through — otherwise top-3 hedge already
      // covered the speculative case.
      const SPEC_THRESHOLD_MS = 1_500;
      const doSpeculative = tried === 1 && !isStream && !caps.hasTools && hedgeStartIdx === 0;
      let peekCandidate: typeof candidate | null = null;
      if (doSpeculative) {
        for (let j = i + 1; j < Math.min(i + 4, spreadCandidates.length); j++) {
          const c = spreadCandidates[j];
          if (c.provider === provider) continue;            // same provider → no multiplexing win
          if (blockedProviders.has(c.provider)) continue;
          peekCandidate = c;
          break;
        }
      }

      try {
        let response: Response;
        if (doSpeculative && peekCandidate) {
          const primaryAc = new AbortController();
          const backupAc = new AbortController();
          const primaryP = forwardToProvider(provider, actualModelId, body, isStream, primaryAc.signal);

          const race = await new Promise<{ r: Response; swap: boolean }>((resolve, reject) => {
            let settled = false;
            let primaryErr: unknown = null;
            let backupFired = false;
            let backupErr: unknown = null;

            primaryP.then(r => {
              if (settled) return;
              settled = true;
              backupAc.abort();
              resolve({ r, swap: false });
            }).catch(err => {
              primaryErr = err;
              if (backupFired && backupErr) {
                if (!settled) { settled = true; reject(primaryErr); }
              } else if (!backupFired && !settled) {
                // Failed fast, before speculative even fired → stop the timer
                settled = true;
                reject(primaryErr);
              }
            });

            const timer = setTimeout(() => {
              if (settled) return;
              backupFired = true;
              console.log(`[SPEC-FIRE:${_reqId}] primary ${provider}/${actualModelId} > ${SPEC_THRESHOLD_MS}ms → speculate with ${peekCandidate!.provider}/${peekCandidate!.model_id}`);
              forwardToProvider(peekCandidate!.provider, peekCandidate!.model_id, body, isStream, backupAc.signal)
                .then(r => {
                  if (settled) return;
                  settled = true;
                  primaryAc.abort();
                  resolve({ r, swap: true });
                })
                .catch(err => {
                  backupErr = err;
                  if (primaryErr && !settled) { settled = true; reject(primaryErr); }
                });
            }, SPEC_THRESHOLD_MS);
            // Let the timer clear if the primary resolves cleanly
            primaryP.finally(() => clearTimeout(timer)).catch(() => {});
          });

          response = race.r;
          if (race.swap && peekCandidate) {
            // Speculative won — swap accounting vars to the winner
            console.log(`[SPEC-WIN:${_reqId}] backup ${peekCandidate.provider}/${peekCandidate.model_id} beat ${provider}/${actualModelId}`);
            provider = peekCandidate.provider;
            actualModelId = peekCandidate.model_id;
            dbModelId = peekCandidate.id;
            triedProviders.add(provider);
          }
        } else {
          response = await forwardToProvider(provider, actualModelId, body, isStream);
        }

        if (response.ok) {
          const latency = Date.now() - startTime;
          await recordProviderSuccessMem(provider, actualModelId);
          if (ip) setSticky(ip, promptCategory, provider, actualModelId);
          if (wasProbing) await recordCircuitProbeResult(provider, actualModelId, true);
          // Parse rate limit headers (Groq/OpenAI-style) → learn limit
          const headerLimit = parseLimitHeaders(response.headers);
          if (headerLimit) {
            recordLimit(provider, actualModelId, headerLimit).catch(() => {});
          }
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
                recordOutcome(provider, actualModelId, false, latency);
                lastError = `${provider}/${actualModelId}: ${badReason}`;
                lastProvider = provider;
                lastModelId = actualModelId;
                continue;
              }

              if (content && THINK_TAG_RE.test(content)) {
                content = cleanResponseContent(content);
                if (json.choices?.[0]?.message) json.choices[0].message.content = content;
              }

              const usage = json.usage;
              await logGateway(modelField, actualModelId, provider, 200, latency,
                usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0, null, userMsg, content?.slice(0, 500) ?? null,
                _reqId, ip);
              await recordRoutingResult(dbModelId, provider, promptCategory, true, latency);
              recordOutcome(provider, actualModelId, true, latency);
              recordOutcomeLearning({
                modelId: dbModelId, provider,
                tokens: estInputTokens, latencyMs: latency, success: true,
                hasTools: caps.hasTools, hasImages: caps.hasImages,
                userMessage: extractUserMessage(body) ?? "",
              }).catch(() => {});
              if (promptCategory === "thai" && content) {
                recordThaiQualityPenalty(
                  dbModelId,
                  provider,
                  extractUserMessage(body) ?? "",
                  content,
                )
                  .then((demoted) => {
                    if (demoted) {
                      console.log(
                        `[THAI-DEMOTE] ${provider}/${actualModelId} failed post-gen Thai check — benchmark score reset`,
                      );
                    }
                  })
                  .catch(() => {});
              }
              // ช้าเกิน threshold → cooldown ถึงแม้จะตอบสำเร็จ (threshold แปรตาม context size)
              const slowThrNon = slowThresholdMs(estTokens);
              if (latency > slowThrNon) {
                await logCooldown(dbModelId, `slow response: ${latency}ms > ${slowThrNon}ms threshold`, 0, 2);
                recordOutcome(provider, actualModelId, false, latency);
                console.log(`[SLOW-COOLDOWN] ${provider}/${actualModelId} ${latency}ms > ${slowThrNon}ms → 2min cooldown`);
              }

              const headers = new Headers();
              headers.set("Content-Type", "application/json");
              headers.set("X-SMLGateway-Provider", provider);
              headers.set("X-SMLGateway-Model", actualModelId);
              if (softBackoff) headers.set("X-Resceo-Backoff", "true");
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
              recordTokenConsumption(provider, actualModelId, totalTokens).catch(() => {});
              // Improvement C: store in response cache (non-stream, low-temp, no tools)
              if (content) {
                setCachedResponse(body, { content, provider, model: actualModelId }).catch(() => { /* non-critical */ });
              }
              recordBattleEvent(outcomeFromLatency(latency, true)).catch(() => { /* cosmetic */ });
              const _pt = usage?.prompt_tokens ?? 0; const _ct = usage?.completion_tokens ?? 0;
              const _tc = hasToolCalls ? (firstMsg!.tool_calls!.length) : 0;
              const _ans = content ? redactForLog(content) : (hasToolCalls ? `[tool_call×${_tc}]` : "-");
              console.log(`[RES:${_reqId}] 200 | ${provider}/${actualModelId} | ${latency}ms | pt=${_pt} ct=${_ct} tc=${_tc} | Q:"${_reqMsg}" A:"${_ans}"`);
              return new Response(JSON.stringify(json), { status: 200, headers });
            } catch {
              // JSON parse failed — fall through
            }
          }

          const proxied = await buildProxiedResponse(response, provider, actualModelId, isStream, estInputTokens, softBackoff, _reqId);
          const streamLatency = Date.now() - startTime;
          await recordRoutingResult(dbModelId, provider, promptCategory, true, streamLatency);
          recordOutcome(provider, actualModelId, true, streamLatency);
          const slowThrStream = slowThresholdMs(estTokens);
          if (streamLatency > slowThrStream) {
            await logCooldown(dbModelId, `slow stream: ${streamLatency}ms > ${slowThrStream}ms threshold`, 0, 2);
            recordOutcome(provider, actualModelId, false, streamLatency);
            console.log(`[SLOW-COOLDOWN] ${provider}/${actualModelId} ${streamLatency}ms > ${slowThrStream}ms → 2min cooldown`);
          }
          await logGateway(modelField, actualModelId, provider, 200, streamLatency, 0, 0, null, userMsg, "[stream]", _reqId, ip);
          recordBattleEvent(outcomeFromLatency(streamLatency, true)).catch(() => { /* cosmetic */ });
          console.log(`[RES:${_reqId}] 200 | ${provider}/${actualModelId} | ${streamLatency}ms | stream | Q:"${_reqMsg}"`);
          return proxied;
        }

        const errText = await response.text().catch(() => "");
        lastError = `${provider}/${actualModelId}: HTTP ${response.status}`;
        lastProvider = provider;
        lastModelId = actualModelId;
        const failLatency = Date.now() - startTime;
        await recordRoutingResult(dbModelId, provider, promptCategory, false, failLatency);
        recordOutcome(provider, actualModelId, false, failLatency);
        recordOutcomeLearning({
          modelId: dbModelId, provider,
          tokens: estInputTokens, latencyMs: failLatency, success: false,
          hasTools: caps.hasTools, hasImages: caps.hasImages,
          userMessage: extractUserMessage(body) ?? "",
          failReason: errText.slice(0, 200),
        }).catch(() => {});
        await recordProviderFailureMem(provider);
        await recordCircuitFailure(provider, actualModelId);
        if (wasProbing) await recordCircuitProbeResult(provider, actualModelId, false);
        const st = response.status;
        console.log(`[RETRY:${_reqId}] ${tried}/${MAX_RETRIES} | ${provider}/${actualModelId} → HTTP ${st} | ${errText.slice(0, 200)}`);

        // Learn limit จาก 429 error message
        if (st === 429) {
          const parsed = parseLimitError(errText);
          if (parsed) {
            recordLimit(provider, actualModelId, parsed).catch(() => {});
          }
        }
        // Learn limit จาก response header ด้วย (บาง provider ส่งมาใน fail response)
        const failHeaderLimit = parseLimitHeaders(response.headers);
        if (failHeaderLimit) {
          recordLimit(provider, actualModelId, failHeaderLimit).catch(() => {});
        }

        // ทุก non-2xx → exponential cooldown → request ถัดไปจะไม่เลือกซ้ำ
        if (st === 400 || st === 402 || st === 429 || st === 413 || st === 422 || st === 410 || st === 404 || st >= 500 || st === 401 || st === 403) {
          // TPD (per-day) limit — groq/gemini ฯลฯ คืน 429 + "daily" หรือ TPD → cooldown 24 ชม.
          const isDailyLimit = st === 429 && /tokens per day|TPD|daily limit|quota exceeded for today/i.test(errText);
          if (isDailyLimit) {
            await logCooldown(dbModelId, `TPD exhausted: ${errText.slice(0, 150)}`, 429, 24 * 60);
            console.log(`[TPD-EXHAUST] ${provider}/${actualModelId} → 24h cooldown`);
          } else if (/context_length|context window|too long for/i.test(errText)) {
            // ตรง context overflow จริงๆ → cooldown 30 นาที (request นี้ใหญ่จริง model นี้ไม่รับ)
            await logCooldown(dbModelId, `Context overflow: ${errText.slice(0, 150)}`, st, 30);
          } else if (st === 413 || st === 422) {
            // 413/422 generic (เช่น Groq TPM overflow) → cooldown สั้น 2 นาที
            // เพราะ model ยังใช้ได้ ถ้า request เล็กกว่า / TPM reset
            await logCooldown(dbModelId, `HTTP ${st}: ${errText.slice(0, 150)}`, st, 2);
          } else {
            // Exponential cooldown: 1m → 2 → 4 → 8 → 16 → 60 min
            const streakCooldownMs = await recordFailStreak(dbModelId);
            const streakMin = Math.round(streakCooldownMs / 60_000);
            await logCooldown(dbModelId, `HTTP ${st}: ${errText}`, st, streakMin);
            console.log(`[EXPO-COOLDOWN:${_reqId}] ${provider}/${actualModelId} → ${streakMin}min (exponential)`);
          }
          // ระบบใช้ free model หลายตัวต่อ provider — cooldown ที่ model เท่านั้น
          // ยกเว้น 401/403 (auth key พัง → กระทบทุก model ใน provider เดียวกัน)
          if (st === 401 || st === 403) blockedProviders.add(provider);
          if (st === 402) {
            await emitEvent("provider_error", `${provider}/${actualModelId} quota หมด (HTTP 402)`, errText.slice(0, 200), provider, actualModelId, "error");
          }
          if (st === 404) {
            // Auto-deactivate after 3 consecutive 404s (stale model)
            try {
              const redis = getRedis();
              const notFoundKey = `404count:${dbModelId}`;
              const count = await redis.incr(notFoundKey);
              await redis.expire(notFoundKey, 86400); // 24h window
              if (count >= 3) {
                await getSqlClient()`
                  INSERT INTO health_logs (model_id, status, error, cooldown_until, checked_at)
                  VALUES (${dbModelId}, 'available', 'auto-deactivated: 3x consecutive 404', now() + interval '30 days', now())
                  ON CONFLICT DO NOTHING
                `;
                console.log(`[AUTO-DEACTIVATE] ${provider}/${actualModelId} — 3x 404, cooldown 30 days`);
              }
            } catch { /* silent */ }
          }
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
        lastProvider = provider;
        lastModelId = actualModelId;
        const streakCd = await recordFailStreak(dbModelId);
        const streakMin = Math.max(1, Math.round(streakCd / 60_000));
        if (isTimeout) {
          console.log(`[TIMEOUT-ATTEMPT:${_reqId}] ${provider}/${actualModelId} timeout → ${streakMin}min`);
          await logCooldown(dbModelId, `timeout: ${errStr.slice(0, 100)}`, 0, streakMin);
        } else {
          await logCooldown(dbModelId, lastError, 0, streakMin);
        }
        const catchLatency = Date.now() - startTime;
        await recordRoutingResult(dbModelId, provider, promptCategory, false, catchLatency);
        recordOutcome(provider, actualModelId, false, catchLatency);
        recordOutcomeLearning({
          modelId: dbModelId, provider,
          tokens: estInputTokens, latencyMs: catchLatency, success: false,
          hasTools: caps.hasTools, hasImages: caps.hasImages,
          userMessage: extractUserMessage(body) ?? "",
          failReason: errStr.slice(0, 200),
        }).catch(() => {});
        await recordProviderFailureMem(provider);
        await recordCircuitFailure(provider, actualModelId);
        if (wasProbing) await recordCircuitProbeResult(provider, actualModelId, false);
        await emitEvent("provider_error", `${provider} เชื่อมต่อไม่ได้`, errStr.slice(0, 200), provider, actualModelId, "warn");
        continue;
      }
    }

    // Log skip reasons breakdown
    if (skipReasons.length > 0) {
      const breakdown: Record<string, number> = {};
      for (const r of skipReasons) {
        const reason = r.split(":").pop() ?? "unknown";
        breakdown[reason] = (breakdown[reason] ?? 0) + 1;
      }
      console.log(`[SKIPS:${_reqId}] tried=${triedProviders.size}, skipped=${skipReasons.length} — ${JSON.stringify(breakdown)}`);
    }

    // ── Second pass: ถ้าไม่มี candidate ไหนได้ลองจริงๆ (ทุกตัวโดน skip) → ลอง skipped candidates แบบ relaxed
    if (triedProviders.size === 0 && skippedCandidates.length > 0 && Date.now() - startTime < TOTAL_TIMEOUT_MS) {
      console.log(`[RELAXED-RETRY:${_reqId}] First pass skipped ${skippedCandidates.length} candidates → retrying ignoring soft filters`);
      for (const candidate of skippedCandidates.slice(0, 5)) {
        if (Date.now() - startTime > TOTAL_TIMEOUT_MS) break;
        const { provider, model_id: actualModelId, id: dbModelId } = candidate;
        // Hard filter เท่านั้น: blocked provider (auth พัง)
        if (blockedProviders.has(provider)) continue;
        triedProviders.add(provider);
        try {
          // Pass remaining budget as AbortSignal so RELAXED-RETRY can't outlive TOTAL_TIMEOUT
          const relaxedRemaining = Math.max(3_000, TOTAL_TIMEOUT_MS - (Date.now() - startTime));
          const response = await forwardToProvider(provider, actualModelId, body, isStream, AbortSignal.timeout(relaxedRemaining));
          if (response.ok) {
            const streamLatency = Date.now() - startTime;
            recordOutcome(provider, actualModelId, true, streamLatency);
            await logGateway(modelField, actualModelId, provider, 200, streamLatency, 0, 0, null, userMsg, "[relaxed-retry]", _reqId, ip);
            console.log(`[RES:${_reqId}] 200 | ${provider}/${actualModelId} | ${streamLatency}ms | relaxed-retry stream | Q:"${_reqMsg}"`);
            return buildProxiedResponse(response, provider, actualModelId, isStream, estInputTokens, softBackoff, _reqId);
          }
          const errText = await response.text().catch(() => "");
          lastError = `${provider}/${actualModelId}: HTTP ${response.status}`;
          lastProvider = provider;
          lastModelId = actualModelId;
          const relCd = await recordFailStreak(dbModelId);
          await logCooldown(dbModelId, `HTTP ${response.status}: ${errText}`, response.status, Math.max(1, Math.round(relCd / 60_000)));
          recordOutcome(provider, actualModelId, false, Date.now() - startTime);
        } catch (err) {
          lastError = `${provider}/${actualModelId}: ${String(err).slice(0, 150)}`;
          lastProvider = provider;
          lastModelId = actualModelId;
          const relCd2 = await recordFailStreak(dbModelId);
          await logCooldown(dbModelId, lastError, 0, Math.max(1, Math.round(relCd2 / 60_000)));
          recordOutcome(provider, actualModelId, false, Date.now() - startTime);
        }
      }
    }

    const latency = Date.now() - startTime;
    // ถ้าไม่มี model ไหนได้ลองเลย → ใช้ candidate แรกเป็น placeholder เฉพาะเพื่อ log
    // *ห้าม* cooldown ใคร — candidate ไม่ได้ผิดอะไร
    if (!lastProvider && spreadCandidates.length > 0) {
      lastProvider = spreadCandidates[0].provider;
      lastModelId = spreadCandidates[0].model_id;
    }
    if (!lastError) {
      const reasonSummary = skipReasons.slice(0, 3).join(", ");
      lastError = `ไม่มี candidate ผ่าน filter — skipped=${skipReasons.length} (${reasonSummary}${skipReasons.length > 3 ? "..." : ""})`;
    }
    await logGateway(modelField, lastModelId, lastProvider, 503, latency, 0, 0, lastError.slice(0, 300), userMsg, null, _reqId, ip);
    recordBattleEvent("fail").catch(() => { /* cosmetic */ });
    console.log(`[RES:${_reqId}] 503 | ${triedProviders.size} tried ${blockedProviders.size} blocked ${skippedCandidates.length} skipped | ${latency}ms | Q:"${_reqMsg}" | ${lastError.slice(0, 150)}`);
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
  estimatedInputTokens = 0,
  softBackoff = false,
  requestId: string | null = null
): Promise<Response> {
  const headers = new Headers();
  headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/json");
  headers.set("X-SMLGateway-Provider", provider);
  headers.set("X-SMLGateway-Model", modelId);
  if (requestId) headers.set("X-SMLGateway-Request-Id", requestId);
  if (softBackoff) headers.set("X-Resceo-Backoff", "true");
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
