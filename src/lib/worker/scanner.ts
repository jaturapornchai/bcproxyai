import { getSqlClient } from "@/lib/db/schema";
import { getNextApiKey, getAvailableProviders } from "@/lib/api-keys";
import { emitEvent } from "@/lib/routing-learn";
import { isProviderEnabled } from "@/lib/provider-toggle";

interface ModelRow {
  id: string;
  name: string;
  provider: string;
  model_id: string;
  context_length: number;
  tier: string;
  description?: string;
  supports_vision?: number;
  supports_tools?: number;
  supports_audio_input?: number;
  supports_audio_output?: number;
  supports_image_gen?: number;
  supports_embedding?: number;
  supports_json_mode?: number;
  supports_reasoning?: number;
  supports_code?: number;
  max_output_tokens?: number;
  pricing_input?: number;
  pricing_output?: number;
}

// ─── Vision & Tools detection from model name / metadata ─────────────────────

const VISION_PATTERNS = [
  /vision/i, /llava/i, /gemini/i, /gemma[34]/i, /pixtral/i,
  /gpt-4o/i, /gpt-4-turbo/i, /claude/i, /qwen.*vl/i, /qwen2\.5-vl/i,
  /qwen3.*vl/i, /internvl/i, /minicpm.*v/i, /cogvlm/i, /phi-3.*vision/i,
  /deepseek-vl/i, /llama-3\.2.*vision/i, /llama-4/i,
  /molmo/i, /moondream/i, /bakllava/i,
];

const TOOLS_PATTERNS = [
  /gemini/i, /gpt-4/i, /gpt-3\.5/i, /claude/i, /mistral.*large/i,
  /mistral.*medium/i, /mixtral/i, /command-r/i, /qwen/i, /llama-3/i,
  /llama-4/i, /deepseek/i, /hermes/i, /firefunction/i, /gorilla/i,
  /nexusraven/i, /functionary/i, /gemma/i,
];

// Models known to support an explicit "thinking / reasoning" mode.
// Detected by name at scan-time → stored in models.supports_reasoning.
// The exam worker + forward path use the DB flag (not this regex at runtime),
// so adding a new pattern here auto-propagates after the next scan cycle.
const REASONING_PATTERNS = [
  /deepseek-r\d/i,           // deepseek-r1, deepseek-r2
  /r1[-_](distill|preview)/i,
  /\bo[134]\b/i, /o1-/i, /o3-/i, /o4-/i, // OpenAI reasoning series
  /qwq/i,                     // Alibaba QwQ
  /\bqwen3\b/i,               // Qwen3 family (dual-mode thinking by default)
  /thinking/i, /\bthink\b/i,  // any model with "think" / "thinking"
  /reasoning/i, /reason-/i,
  /magistral/i,               // Mistral reasoning variant
  /gemini.*thinking/i,
  /\blfm-.*thinking/i,        // Liquid LFM thinking
  /nemotron-.*reasoning/i,    // NVIDIA Nemotron reasoning
  /pathumma.*think/i,         // NECTEC Pathumma think
];

const CODE_PATTERNS = [
  /codestral/i, /starcoder/i, /codellama/i, /code-/i, /coder/i,
  /devstral/i, /deepseek-coder/i, /granite-code/i, /leanstral/i,
];

const EMBEDDING_PATTERNS = [
  /embed/i, /e5-/i, /bge-/i, /gte-/i, /nomic-embed/i, /text-embedding/i,
];

const IMAGE_GEN_PATTERNS = [
  /dall-e/i, /stable-diffusion/i, /sdxl/i, /flux/i, /imagen/i,
  /lyria/i, /playground/i,
];

const AUDIO_INPUT_PATTERNS = [
  /whisper/i, /transcri/i, /voxtral/i, /speech-to/i,
];

const AUDIO_OUTPUT_PATTERNS = [
  /tts/i, /speech/i, /voxtral.*tts/i, /audio.*output/i,
];

const JSON_MODE_PATTERNS = [
  /gpt-4/i, /gpt-3\.5/i, /gemini/i, /claude/i, /mistral.*large/i,
  /mistral.*medium/i, /mistral.*small/i, /qwen/i, /llama-3/i, /llama-4/i,
  /deepseek/i, /gemma/i, /command-r/i,
];

function detectCaps(
  modelId: string,
  name: string,
  providerMeta?: { reasoning?: boolean },
): Partial<ModelRow> {
  const combined = `${modelId} ${name}`;
  // Reasoning: prefer provider metadata when available (OpenRouter tells us via
  // `supported_parameters: ["reasoning", ...]`). Fall back to name regex.
  const reasoning = providerMeta?.reasoning === true
    ? 1
    : providerMeta?.reasoning === false
      ? 0
      : REASONING_PATTERNS.some(p => p.test(combined)) ? 1 : 0;
  return {
    supports_reasoning: reasoning,
    supports_code: CODE_PATTERNS.some(p => p.test(combined)) ? 1 : 0,
    supports_embedding: EMBEDDING_PATTERNS.some(p => p.test(combined)) ? 1 : 0,
    supports_image_gen: IMAGE_GEN_PATTERNS.some(p => p.test(combined)) ? 1 : 0,
    supports_audio_input: AUDIO_INPUT_PATTERNS.some(p => p.test(combined)) ? 1 : 0,
    supports_audio_output: AUDIO_OUTPUT_PATTERNS.some(p => p.test(combined)) ? 1 : 0,
    supports_json_mode: JSON_MODE_PATTERNS.some(p => p.test(combined)) ? 1 : 0,
  };
}

function detectVision(modelId: string, name: string, providerMeta?: { vision?: boolean }): number {
  if (providerMeta?.vision === true) return 1;
  if (providerMeta?.vision === false) return 0;
  const combined = `${modelId} ${name}`;
  return VISION_PATTERNS.some(p => p.test(combined)) ? 1 : 0;
}

function detectTools(modelId: string, name: string, providerMeta?: { tools?: boolean }): number {
  if (providerMeta?.tools === true) return 1;
  if (providerMeta?.tools === false) return 0;
  const combined = `${modelId} ${name}`;
  return TOOLS_PATTERNS.some(p => p.test(combined)) ? 1 : 0;
}

export function calcTier(contextLength: number): string {
  if (contextLength >= 128000) return "large";
  if (contextLength >= 32000) return "medium";
  return "small";
}

async function logWorker(step: string, message: string, level = "info") {
  try {
    const sql = getSqlClient();
    await sql`INSERT INTO worker_logs (step, message, level) VALUES (${step}, ${message}, ${level})`;
  } catch {
    // silent
  }
}

async function fetchOpenRouterModels(): Promise<ModelRow[]> {
  const key = getNextApiKey("openrouter");
  if (!key) return [];
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models: ModelRow[] = [];
    for (const m of json.data ?? []) {
      if (m.pricing?.prompt !== "0") continue;
      const ctx = m.context_length ?? 0;
      const arch = m.architecture ?? {};
      const sp: string[] = Array.isArray(m.supported_parameters) ? m.supported_parameters : [];
      const hasReasoning = sp.includes("reasoning") || sp.includes("include_reasoning") || sp.includes("reasoning_effort");
      models.push({
        id: `openrouter:${m.id}`,
        name: m.name ?? m.id,
        provider: "openrouter",
        model_id: m.id,
        context_length: ctx,
        tier: calcTier(ctx),
        description: m.description ?? undefined,
        supports_vision: detectVision(m.id, m.name ?? "", { vision: arch.modality?.includes("image") }),
        supports_tools: detectTools(m.id, m.name ?? "", { tools: arch.tool_use }),
        supports_reasoning: hasReasoning ? 1 : undefined,
      });
    }
    return models;
  } catch (err) {
    await logWorker("scan", `OpenRouter fetch error: ${err}`, "error");
    return [];
  }
}

async function fetchKiloModels(): Promise<ModelRow[]> {
  const kiloKey = getNextApiKey("kilo");
  if (!kiloKey) return [];
  try {
    const res = await fetch("https://api.kilo.ai/api/gateway/models", {
      headers: { Authorization: `Bearer ${kiloKey}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models: ModelRow[] = [];
    for (const m of json.data ?? json.models ?? []) {
      const mid: string = m.id ?? "";
      if (!mid.endsWith(":free")) continue;
      const ctx = m.context_length ?? 0;
      models.push({
        id: `kilo:${mid}`,
        name: m.name ?? mid,
        provider: "kilo",
        model_id: mid,
        context_length: ctx,
        tier: calcTier(ctx),
        description: m.description ?? undefined,
        supports_vision: detectVision(mid, m.name ?? ""),
        supports_tools: detectTools(mid, m.name ?? ""),
      });
    }
    return models;
  } catch (err) {
    await logWorker("scan", `Kilo fetch error: ${err}`, "error");
    return [];
  }
}

async function fetchGoogleModels(): Promise<ModelRow[]> {
  const key = getNextApiKey("google");
  if (!key) return [];
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models: ModelRow[] = [];
    for (const m of json.models ?? []) {
      const mid: string = (m.name ?? "").replace("models/", "");
      if (!mid) continue;
      const methods: string[] = m.supportedGenerationMethods ?? [];
      if (!methods.includes("generateContent")) continue;
      const ctx = m.inputTokenLimit ?? 0;
      const hasVision = methods.includes("generateContent") && /gemini/i.test(mid);
      models.push({
        id: `google:${mid}`,
        name: m.displayName ?? mid,
        provider: "google",
        model_id: mid,
        context_length: ctx,
        tier: calcTier(ctx),
        description: m.description ?? undefined,
        supports_vision: hasVision ? 1 : detectVision(mid, m.displayName ?? ""),
        supports_tools: detectTools(mid, m.displayName ?? ""),
      });
    }
    return models;
  } catch (err) {
    await logWorker("scan", `Google fetch error: ${err}`, "error");
    return [];
  }
}

async function fetchGroqModels(): Promise<ModelRow[]> {
  const key = getNextApiKey("groq");
  if (!key) return [];
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models: ModelRow[] = [];
    for (const m of json.data ?? []) {
      const mid: string = m.id ?? "";
      const ctx = m.context_window ?? 0;
      models.push({
        id: `groq:${mid}`,
        name: m.id,
        provider: "groq",
        model_id: mid,
        context_length: ctx,
        tier: calcTier(ctx),
        description: undefined,
        supports_vision: detectVision(mid, m.id ?? ""),
        supports_tools: detectTools(mid, m.id ?? ""),
      });
    }
    return models;
  } catch (err) {
    await logWorker("scan", `Groq fetch error: ${err}`, "error");
    return [];
  }
}

const NON_CHAT_KEYWORDS = ["whisper", "lyria", "orpheus", "prompt-guard", "safeguard", "compound", "allam"];

async function fetchCerebrasModels(): Promise<ModelRow[]> {
  const cerebrasKey = getNextApiKey("cerebras");
  if (!cerebrasKey) return [];
  try {
    const res = await fetch("https://api.cerebras.ai/v1/models", {
      headers: { Authorization: `Bearer ${cerebrasKey}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models: ModelRow[] = [];
    // Cerebras API ไม่คืน context_length — ใช้ค่าที่ publish บน docs
    const CEREBRAS_CONTEXT: Record<string, number> = {
      "llama3.1-8b":                    8_192,
      "llama-3.3-70b":                  65_536,
      "llama-4-scout-17b-16e-instruct": 131_072,
      "llama-4-maverick-17b-128e-instruct": 32_768,
      "qwen-3-235b-a22b-instruct-2507": 131_072,
      "qwen-3-coder-480b":              131_072,
      "qwen-3-32b":                     32_768,
      "gpt-oss-120b":                   131_072,
      "zai-glm-4.7":                    131_072,
      "deepseek-r1-distill-llama-70b":  32_768,
    };
    for (const m of json.data ?? []) {
      const mid: string = m.id ?? "";
      if (NON_CHAT_KEYWORDS.some((kw) => mid.toLowerCase().includes(kw))) continue;
      const apiCtx = m.context_window ?? m.context_length ?? m.max_context_length ?? 0;
      const ctx = apiCtx > 0 ? apiCtx : (CEREBRAS_CONTEXT[mid] ?? 32_768);
      models.push({
        id: `cerebras:${mid}`,
        name: m.id,
        provider: "cerebras",
        model_id: mid,
        context_length: ctx,
        tier: calcTier(ctx),
        description: undefined,
        supports_vision: detectVision(mid, m.id ?? ""),
        supports_tools: detectTools(mid, m.id ?? ""),
      });
    }
    return models;
  } catch (err) {
    await logWorker("scan", `Cerebras fetch error: ${err}`, "error");
    return [];
  }
}

async function fetchSambaNovaModels(): Promise<ModelRow[]> {
  const sambaKey = getNextApiKey("sambanova");
  if (!sambaKey) return [];
  try {
    const res = await fetch("https://api.sambanova.ai/v1/models", {
      headers: { Authorization: `Bearer ${sambaKey}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models: ModelRow[] = [];
    for (const m of json.data ?? []) {
      const mid: string = m.id ?? "";
      const ctx = m.context_window ?? m.context_length ?? m.max_context_length ?? m.max_tokens ?? 0;
      models.push({
        id: `sambanova:${mid}`,
        name: m.id,
        provider: "sambanova",
        model_id: mid,
        context_length: ctx,
        tier: calcTier(ctx),
        description: undefined,
        supports_vision: detectVision(mid, m.id ?? ""),
        supports_tools: detectTools(mid, m.id ?? ""),
      });
    }
    return models;
  } catch (err) {
    await logWorker("scan", `SambaNova fetch error: ${err}`, "error");
    return [];
  }
}

async function fetchMistralModels(): Promise<ModelRow[]> {
  const mistralKey = getNextApiKey("mistral");
  if (!mistralKey) return [];
  try {
    const res = await fetch("https://api.mistral.ai/v1/models", {
      headers: { Authorization: `Bearer ${mistralKey}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models: ModelRow[] = [];
    for (const m of json.data ?? []) {
      const mid: string = m.id ?? "";
      const ctx = m.max_context_length ?? m.context_window ?? m.context_length ?? 0;
      models.push({
        id: `mistral:${mid}`,
        name: m.id,
        provider: "mistral",
        model_id: mid,
        context_length: ctx,
        tier: calcTier(ctx),
        description: undefined,
        supports_vision: detectVision(mid, m.id ?? "", { vision: m.capabilities?.vision }),
        supports_tools: detectTools(mid, m.id ?? "", { tools: m.capabilities?.function_calling }),
      });
    }
    return models;
  } catch (err) {
    await logWorker("scan", `Mistral fetch error: ${err}`, "error");
    return [];
  }
}

async function fetchOllamaModels(): Promise<ModelRow[]> {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models: ModelRow[] = [];
    for (const m of json.models ?? []) {
      const name: string = m.name ?? m.model ?? "";
      if (!name) continue;
      const sizeGB = (m.size ?? 0) / (1024 * 1024 * 1024);
      const ctx = 128000;
      models.push({
        id: `ollama:${name}`,
        name: name,
        provider: "ollama",
        model_id: name,
        context_length: ctx,
        tier: calcTier(ctx),
        description: `Local model (${sizeGB.toFixed(1)}GB)`,
        supports_vision: detectVision(name, name),
        supports_tools: detectTools(name, name),
      });
    }
    return models;
  } catch {
    return [];
  }
}

async function fetchGitHubModels(): Promise<ModelRow[]> {
  const token = getNextApiKey("github");
  if (!token) return [];
  try {
    const res = await fetch("https://models.github.ai/inference/models", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models: ModelRow[] = [];
    for (const m of json.data ?? json ?? []) {
      const mid: string = m.id ?? m.name ?? "";
      if (!mid) continue;
      if (NON_CHAT_KEYWORDS.some((kw) => mid.toLowerCase().includes(kw))) continue;
      const ctx = m.context_length ?? m.context_window ?? m.max_tokens ?? 128000;
      models.push({
        id: `github:${mid}`,
        name: m.friendly_name ?? m.name ?? mid,
        provider: "github",
        model_id: mid,
        context_length: ctx,
        tier: calcTier(ctx),
        description: m.summary ?? undefined,
        supports_vision: detectVision(mid, m.name ?? ""),
        supports_tools: detectTools(mid, m.name ?? ""),
      });
    }
    return models;
  } catch (err) {
    await logWorker("scan", `GitHub Models fetch error: ${err}`, "error");
    return [];
  }
}

async function fetchFireworksModels(): Promise<ModelRow[]> {
  const apiKey = getNextApiKey("fireworks");
  if (!apiKey) return [];
  try {
    const res = await fetch("https://api.fireworks.ai/inference/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models: ModelRow[] = [];
    for (const m of json.data ?? []) {
      const mid: string = m.id ?? "";
      if (!mid) continue;
      if (NON_CHAT_KEYWORDS.some((kw) => mid.toLowerCase().includes(kw))) continue;
      const ctx = m.context_length ?? m.context_window ?? 0;
      models.push({
        id: `fireworks:${mid}`,
        name: m.id,
        provider: "fireworks",
        model_id: mid,
        context_length: ctx,
        tier: calcTier(ctx),
        description: undefined,
        supports_vision: detectVision(mid, m.id ?? ""),
        supports_tools: detectTools(mid, m.id ?? ""),
      });
    }
    return models;
  } catch (err) {
    await logWorker("scan", `Fireworks fetch error: ${err}`, "error");
    return [];
  }
}

async function fetchCohereModels(): Promise<ModelRow[]> {
  const apiKey = getNextApiKey("cohere");
  if (!apiKey) return [];
  try {
    const res = await fetch("https://api.cohere.com/v2/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models: ModelRow[] = [];
    for (const m of json.models ?? json.data ?? []) {
      const mid: string = m.name ?? m.id ?? "";
      if (!mid) continue;
      if (m.endpoints && !m.endpoints.includes("chat")) continue;
      const ctx = m.context_length ?? m.max_tokens ?? 128000;
      models.push({
        id: `cohere:${mid}`,
        name: m.name ?? mid,
        provider: "cohere",
        model_id: mid,
        context_length: ctx,
        tier: calcTier(ctx),
        description: undefined,
        supports_vision: detectVision(mid, m.name ?? ""),
        supports_tools: m.endpoints?.includes("tool_use") ? 1 : detectTools(mid, m.name ?? ""),
      });
    }
    return models;
  } catch (err) {
    await logWorker("scan", `Cohere fetch error: ${err}`, "error");
    return [];
  }
}

async function fetchCloudflareModels(): Promise<ModelRow[]> {
  const token = getNextApiKey("cloudflare");
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) return [];
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search?task=Text Generation`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models: ModelRow[] = [];
    for (const m of json.result ?? []) {
      const mid: string = m.name ?? "";
      if (!mid) continue;
      const ctx = m.properties?.max_input_tokens ?? 32000;
      models.push({
        id: `cloudflare:${mid}`,
        name: m.name ?? mid,
        provider: "cloudflare",
        model_id: mid,
        context_length: ctx,
        tier: calcTier(ctx),
        description: m.description ?? undefined,
        supports_vision: detectVision(mid, m.name ?? ""),
        supports_tools: detectTools(mid, m.name ?? ""),
      });
    }
    return models;
  } catch (err) {
    await logWorker("scan", `Cloudflare fetch error: ${err}`, "error");
    return [];
  }
}

async function fetchNvidiaModels(): Promise<ModelRow[]> {
  const apiKey = getNextApiKey("nvidia");
  if (!apiKey) return [];
  try {
    const res = await fetch("https://integrate.api.nvidia.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models: ModelRow[] = [];
    for (const m of json.data ?? []) {
      const mid: string = m.id ?? "";
      if (!mid) continue;
      if (NON_CHAT_KEYWORDS.some((kw) => mid.toLowerCase().includes(kw))) continue;
      // NVIDIA catalog มีทั้ง chat, embed, rerank, vision — กรองเอาเฉพาะ chat
      if (/embed|rerank|ocr|stt|tts|whisper|guard|safety/i.test(mid)) continue;
      // NVIDIA API ไม่ส่ง context_length กลับมา → ใช้ default ที่สมเหตุสมผล
      const ctx = m.context_length ?? m.context_window ?? 32_768;
      models.push({
        id: `nvidia:${mid}`,
        name: mid.split("/").pop() ?? mid,
        provider: "nvidia",
        model_id: mid,
        context_length: ctx,
        tier: calcTier(ctx),
        description: undefined,
        supports_vision: detectVision(mid, mid),
        supports_tools: detectTools(mid, mid),
      });
    }
    return models;
  } catch (err) {
    await logWorker("scan", `NVIDIA fetch error: ${err}`, "error");
    return [];
  }
}

// ─── Generic OpenAI-compatible fetcher ────────────────────────────────────────
// ใช้กับ provider ที่ API เป็น standard OpenAI format:
//   - GET /models → { data: [{ id, context_length? }] }
//   - POST /chat/completions
async function fetchGenericOpenAI(opts: {
  provider: string;
  envKeyName: string;
  modelsUrl: string;
  defaultContext?: number;
  headers?: Record<string, string>;
  modelFilter?: (id: string) => boolean;
  contextOverride?: (id: string, m: Record<string, unknown>) => number | undefined;
}): Promise<ModelRow[]> {
  void opts.envKeyName;
  const apiKey = getNextApiKey(opts.provider);
  if (!apiKey) return [];
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      ...(opts.headers ?? {}),
    };
    const res = await fetch(opts.modelsUrl, {
      headers,
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const list = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
    const models: ModelRow[] = [];
    for (const m of list) {
      const mid: string = String(m.id ?? m.name ?? "");
      if (!mid) continue;
      if (NON_CHAT_KEYWORDS.some((kw) => mid.toLowerCase().includes(kw))) continue;
      if (/embed|rerank|ocr|stt|tts|whisper|guard|safety|moderation|transcrib|speech|audio|image[_-]gen|sdxl|flux|dall|lyria/i.test(mid)) continue;
      if (opts.modelFilter && !opts.modelFilter(mid)) continue;
      const apiCtx =
        (m.context_length as number | undefined) ??
        (m.context_window as number | undefined) ??
        (m.max_context_length as number | undefined) ??
        (m.max_input_tokens as number | undefined);
      const overrideCtx = opts.contextOverride?.(mid, m);
      const ctx = overrideCtx ?? apiCtx ?? opts.defaultContext ?? 32_768;
      models.push({
        id: `${opts.provider}:${mid}`,
        name: mid.split("/").pop() ?? mid,
        provider: opts.provider,
        model_id: mid,
        context_length: ctx,
        tier: calcTier(ctx),
        description: typeof m.description === "string" ? m.description.slice(0, 200) : undefined,
        supports_vision: detectVision(mid, mid),
        supports_tools: detectTools(mid, mid),
      });
    }
    return models;
  } catch (err) {
    await logWorker("scan", `${opts.provider} fetch error: ${err}`, "error");
    return [];
  }
}

// ─── New providers (12) — all OpenAI-compatible ───────────────────────────────

async function fetchChutesModels(): Promise<ModelRow[]> {
  return fetchGenericOpenAI({
    provider: "chutes",
    envKeyName: "CHUTES_API_KEY",
    modelsUrl: "https://llm.chutes.ai/v1/models",
    defaultContext: 32_768,
  });
}

async function fetchLlm7Models(): Promise<ModelRow[]> {
  return fetchGenericOpenAI({
    provider: "llm7",
    envKeyName: "LLM7_API_KEY",
    modelsUrl: "https://api.llm7.io/v1/models",
    defaultContext: 32_768,
  });
}

async function fetchScalewayModels(): Promise<ModelRow[]> {
  // Scaleway อาจต้องใช้ X-Auth-Token header บาง region — ลอง Bearer ก่อน
  return fetchGenericOpenAI({
    provider: "scaleway",
    envKeyName: "SCALEWAY_API_KEY",
    modelsUrl: "https://api.scaleway.ai/v1/models",
    defaultContext: 32_768,
  });
}

async function fetchPollinationsModels(): Promise<ModelRow[]> {
  // Pollinations แยก text models endpoint
  try {
    const res = await fetch("https://text.pollinations.ai/models", {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const list = Array.isArray(json) ? json : [];
    const models: ModelRow[] = [];
    for (const m of list) {
      const mid: string = typeof m === "string" ? m : String(m.name ?? m.id ?? "");
      if (!mid) continue;
      if (NON_CHAT_KEYWORDS.some((kw) => mid.toLowerCase().includes(kw))) continue;
      if (/embed|rerank|image|audio|speech|tts|stt|flux|dall|sdxl/i.test(mid)) continue;
      const ctx = 32_768;
      models.push({
        id: `pollinations:${mid}`,
        name: mid,
        provider: "pollinations",
        model_id: mid,
        context_length: ctx,
        tier: calcTier(ctx),
        description: undefined,
        supports_vision: detectVision(mid, mid),
        supports_tools: detectTools(mid, mid),
      });
    }
    return models;
  } catch (err) {
    await logWorker("scan", `Pollinations fetch error: ${err}`, "error");
    return [];
  }
}

async function fetchOllamaCloudModels(): Promise<ModelRow[]> {
  return fetchGenericOpenAI({
    provider: "ollamacloud",
    envKeyName: "OLLAMA_CLOUD_API_KEY",
    modelsUrl: "https://ollama.com/api/tags",
    defaultContext: 131_072,
    modelFilter: (id) => id.includes(":") || id.includes("cloud"),
  });
}

async function fetchSiliconFlowModels(): Promise<ModelRow[]> {
  return fetchGenericOpenAI({
    provider: "siliconflow",
    envKeyName: "SILICONFLOW_API_KEY",
    modelsUrl: "https://api.siliconflow.cn/v1/models",
    defaultContext: 32_768,
  });
}

async function fetchGlhfModels(): Promise<ModelRow[]> {
  // glhf ไม่มี model list endpoint — hardcode curated list
  const apiKey = getNextApiKey("glhf");
  if (!apiKey) return [];
  const curatedModels = [
    { id: "hf:meta-llama/Llama-3.3-70B-Instruct", ctx: 131_072 },
    { id: "hf:meta-llama/Meta-Llama-3.1-405B-Instruct", ctx: 131_072 },
    { id: "hf:meta-llama/Meta-Llama-3.1-70B-Instruct", ctx: 131_072 },
    { id: "hf:Qwen/Qwen2.5-72B-Instruct", ctx: 131_072 },
    { id: "hf:Qwen/Qwen2.5-Coder-32B-Instruct", ctx: 131_072 },
    { id: "hf:Qwen/QwQ-32B-Preview", ctx: 32_768 },
    { id: "hf:mistralai/Mixtral-8x22B-Instruct-v0.1", ctx: 65_536 },
    { id: "hf:deepseek-ai/DeepSeek-V3", ctx: 131_072 },
    { id: "hf:deepseek-ai/DeepSeek-R1", ctx: 131_072 },
  ];
  return curatedModels.map((m) => ({
    id: `glhf:${m.id}`,
    name: m.id.replace("hf:", "").split("/").pop() ?? m.id,
    provider: "glhf",
    model_id: m.id,
    context_length: m.ctx,
    tier: calcTier(m.ctx),
    description: undefined,
    supports_vision: detectVision(m.id, m.id),
    supports_tools: detectTools(m.id, m.id),
  }));
}

async function fetchTogetherModels(): Promise<ModelRow[]> {
  return fetchGenericOpenAI({
    provider: "together",
    envKeyName: "TOGETHER_API_KEY",
    modelsUrl: "https://api.together.xyz/v1/models",
    defaultContext: 32_768,
    modelFilter: (id) => !/image|video|audio|embed|rerank/i.test(id),
  });
}

async function fetchHyperbolicModels(): Promise<ModelRow[]> {
  return fetchGenericOpenAI({
    provider: "hyperbolic",
    envKeyName: "HYPERBOLIC_API_KEY",
    modelsUrl: "https://api.hyperbolic.xyz/v1/models",
    defaultContext: 32_768,
  });
}

async function fetchZaiModels(): Promise<ModelRow[]> {
  // Z.AI ไม่มี public model list — curated จาก docs
  const apiKey = getNextApiKey("zai");
  if (!apiKey) return [];
  const curated = [
    { id: "glm-4.5-flash", ctx: 131_072 },
    { id: "glm-4-flash", ctx: 131_072 },
    { id: "glm-4-plus", ctx: 131_072 },
    { id: "glm-4-air", ctx: 131_072 },
    { id: "glm-4-long", ctx: 1_000_000 },
    { id: "glm-4.5", ctx: 131_072 },
  ];
  return curated.map((m) => ({
    id: `zai:${m.id}`,
    name: m.id,
    provider: "zai",
    model_id: m.id,
    context_length: m.ctx,
    tier: calcTier(m.ctx),
    description: undefined,
    supports_vision: detectVision(m.id, m.id),
    supports_tools: detectTools(m.id, m.id),
  }));
}

async function fetchDashScopeModels(): Promise<ModelRow[]> {
  // DashScope (Qwen via Alibaba) — curated because model list endpoint is restricted
  const apiKey = getNextApiKey("dashscope");
  if (!apiKey) return [];
  const curated = [
    { id: "qwen-max", ctx: 32_768 },
    { id: "qwen-plus", ctx: 131_072 },
    { id: "qwen-turbo", ctx: 131_072 },
    { id: "qwen2.5-72b-instruct", ctx: 131_072 },
    { id: "qwen2.5-32b-instruct", ctx: 131_072 },
    { id: "qwen2.5-14b-instruct", ctx: 131_072 },
    { id: "qwen2.5-7b-instruct", ctx: 131_072 },
    { id: "qwen2.5-coder-32b-instruct", ctx: 131_072 },
    { id: "qwen-vl-max", ctx: 32_768 },
    { id: "qwen-vl-plus", ctx: 32_768 },
  ];
  return curated.map((m) => ({
    id: `dashscope:${m.id}`,
    name: m.id,
    provider: "dashscope",
    model_id: m.id,
    context_length: m.ctx,
    tier: calcTier(m.ctx),
    description: undefined,
    supports_vision: /vl/i.test(m.id) ? 1 : 0,
    supports_tools: 1,
  }));
}

async function fetchRekaModels(): Promise<ModelRow[]> {
  return fetchGenericOpenAI({
    provider: "reka",
    envKeyName: "REKA_API_KEY",
    modelsUrl: "https://api.reka.ai/v1/models",
    defaultContext: 128_000,
  });
}

async function fetchTyphoonModels(): Promise<ModelRow[]> {
  return fetchGenericOpenAI({
    provider: "typhoon",
    envKeyName: "TYPHOON_API_KEY",
    modelsUrl: "https://api.opentyphoon.ai/v1/models",
    defaultContext: 32_768,
  });
}

async function fetchThaiLLMModels(): Promise<ModelRow[]> {
  // ThaiLLM national platform — unified endpoint for 4 Thai-developed models
  // (OpenThaiGPT/AIEAT, Typhoon-S/SCB 10X, Pathumma/NECTEC, THaLLE/KBTG)
  return fetchGenericOpenAI({
    provider: "thaillm",
    envKeyName: "THAILLM_API_KEY",
    modelsUrl: "https://api.thaillm.or.th/v1/models",
    defaultContext: 32_768,
  });
}

async function fetchHuggingFaceModels(): Promise<ModelRow[]> {
  const token = getNextApiKey("huggingface");
  if (!token) return [];
  try {
    const res = await fetch("https://huggingface.co/api/models?pipeline_tag=text-generation&sort=trending&limit=30&filter=endpoints_compatible", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models: ModelRow[] = [];
    for (const m of json ?? []) {
      const mid: string = m.id ?? m.modelId ?? "";
      if (!mid) continue;
      if (NON_CHAT_KEYWORDS.some((kw) => mid.toLowerCase().includes(kw))) continue;
      const tags: string[] = m.tags ?? [];
      if (!tags.includes("conversational") && !tags.includes("text-generation")) continue;
      const ctx = m.config?.max_position_embeddings ?? 32000;
      models.push({
        id: `huggingface:${mid}`,
        name: mid.split("/").pop() ?? mid,
        provider: "huggingface",
        model_id: mid,
        context_length: ctx,
        tier: calcTier(ctx),
        description: m.description?.slice(0, 200) ?? undefined,
        supports_vision: detectVision(mid, m.id ?? "", { vision: tags.includes("image-text-to-text") }),
        supports_tools: detectTools(mid, m.id ?? ""),
      });
    }
    return models;
  } catch (err) {
    await logWorker("scan", `HuggingFace fetch error: ${err}`, "error");
    return [];
  }
}

// Nickname generation removed — UI shows provider + model_id directly.
// Kept as no-op export for backward compat with other modules that still import it.
export async function generateNickname(): Promise<string | null> {
  return null;
}

export async function scanModels(): Promise<{ found: number; new: number; disappeared: number }> {
  await logWorker("scan", "Starting model scan");
  const sql = getSqlClient();

  // ลบ model ของ provider ที่ไม่มี API key ออกจากระบบ (ใช้ไม่ได้)
  try {
    const availableProviders = getAvailableProviders();
    const deleted = await sql<{ id: string; provider: string }[]>`
      DELETE FROM models
      WHERE provider NOT IN ${sql(availableProviders)}
      RETURNING id, provider
    `;
    if (deleted.length > 0) {
      const byProvider: Record<string, number> = {};
      for (const r of deleted) byProvider[r.provider] = (byProvider[r.provider] ?? 0) + 1;
      await logWorker("scan", `🗑️ ลบ ${deleted.length} model จาก provider ที่ไม่มี key: ${JSON.stringify(byProvider)}`, "warn");
    }
  } catch (err) {
    await logWorker("scan", `ลบ model ไม่มี-key ล้มเหลว: ${err}`, "error");
  }

  // Helper: ข้าม provider ที่ปิดเอง
  const guard = async <T>(name: string, fn: () => Promise<T[]>): Promise<T[]> => {
    if (!(await isProviderEnabled(name))) return [];
    return fn();
  };

  const [
    orModels, kiloModels, googleModels, groqModels, cerebrasModels, sambaNovaModels,
    mistralModels, ollamaModels, githubModels, fireworksModels, cohereModels,
    cloudflareModels, hfModels, nvidiaModels,
    chutesModels, llm7Models, scalewayModels, pollinationsModels, ollamaCloudModels,
    siliconflowModels, glhfModels, togetherModels, hyperbolicModels,
    zaiModels, dashscopeModels, rekaModels, typhoonModels, thaillmModels,
  ] = await Promise.all([
    guard("openrouter", fetchOpenRouterModels),
    guard("kilo", fetchKiloModels),
    guard("google", fetchGoogleModels),
    guard("groq", fetchGroqModels),
    guard("cerebras", fetchCerebrasModels),
    guard("sambanova", fetchSambaNovaModels),
    guard("mistral", fetchMistralModels),
    guard("ollama", fetchOllamaModels),
    guard("github", fetchGitHubModels),
    guard("fireworks", fetchFireworksModels),
    guard("cohere", fetchCohereModels),
    guard("cloudflare", fetchCloudflareModels),
    guard("huggingface", fetchHuggingFaceModels),
    guard("nvidia", fetchNvidiaModels),
    guard("chutes", fetchChutesModels),
    guard("llm7", fetchLlm7Models),
    guard("scaleway", fetchScalewayModels),
    guard("pollinations", fetchPollinationsModels),
    guard("ollamacloud", fetchOllamaCloudModels),
    guard("siliconflow", fetchSiliconFlowModels),
    guard("glhf", fetchGlhfModels),
    guard("together", fetchTogetherModels),
    guard("hyperbolic", fetchHyperbolicModels),
    guard("zai", fetchZaiModels),
    guard("dashscope", fetchDashScopeModels),
    guard("reka", fetchRekaModels),
    guard("typhoon", fetchTyphoonModels),
    guard("thaillm", fetchThaiLLMModels),
  ]);

  const allModels = [
    ...orModels, ...kiloModels, ...googleModels, ...groqModels, ...cerebrasModels, ...sambaNovaModels,
    ...mistralModels, ...ollamaModels, ...githubModels, ...fireworksModels, ...cohereModels,
    ...cloudflareModels, ...hfModels, ...nvidiaModels,
    ...chutesModels, ...llm7Models, ...scalewayModels, ...pollinationsModels, ...ollamaCloudModels,
    ...siliconflowModels, ...glhfModels, ...togetherModels, ...hyperbolicModels,
    ...zaiModels, ...dashscopeModels, ...rekaModels, ...typhoonModels, ...thaillmModels,
  ];
  const foundIds = new Set(allModels.map(m => m.id));
  let newCount = 0;

  const newModels: ModelRow[] = [];

  // Upsert models one at a time (postgres tagged templates don't support batch upsert cleanly)
  for (const m of allModels) {
    // Honor reasoning flag set by the fetcher (e.g. OpenRouter's
    // `supported_parameters: ["reasoning", ...]`) when present — cap detection
    // only uses name-regex so metadata beats guesswork.
    const caps = detectCaps(m.model_id, m.name, {
      reasoning: m.supports_reasoning === 1 ? true : undefined,
    });
    try {
      const result = await sql<{ xmax: string }[]>`
        INSERT INTO models (id, name, provider, model_id, context_length, tier, description,
          supports_vision, supports_tools, supports_audio_input, supports_audio_output,
          supports_image_gen, supports_embedding, supports_json_mode, supports_reasoning, supports_code,
          max_output_tokens, pricing_input, pricing_output)
        VALUES (
          ${m.id}, ${m.name}, ${m.provider}, ${m.model_id}, ${m.context_length}, ${m.tier},
          ${m.description ?? null},
          ${m.supports_vision ?? -1}, ${m.supports_tools ?? -1},
          ${caps.supports_audio_input ?? 0}, ${caps.supports_audio_output ?? 0},
          ${caps.supports_image_gen ?? 0}, ${caps.supports_embedding ?? 0},
          ${caps.supports_json_mode ?? 0}, ${caps.supports_reasoning ?? 0}, ${caps.supports_code ?? 0},
          ${m.max_output_tokens ?? 0}, ${m.pricing_input ?? 0}, ${m.pricing_output ?? 0}
        )
        ON CONFLICT (id) DO UPDATE SET
          last_seen = now(), context_length = EXCLUDED.context_length, tier = EXCLUDED.tier,
          supports_vision = EXCLUDED.supports_vision, supports_tools = EXCLUDED.supports_tools,
          supports_audio_input = EXCLUDED.supports_audio_input, supports_audio_output = EXCLUDED.supports_audio_output,
          supports_image_gen = EXCLUDED.supports_image_gen, supports_embedding = EXCLUDED.supports_embedding,
          supports_json_mode = EXCLUDED.supports_json_mode, supports_reasoning = EXCLUDED.supports_reasoning,
          supports_code = EXCLUDED.supports_code, max_output_tokens = EXCLUDED.max_output_tokens,
          pricing_input = EXCLUDED.pricing_input, pricing_output = EXCLUDED.pricing_output
        RETURNING (xmax = 0) as inserted
      `;
      // xmax=0 means it was a fresh INSERT (not UPDATE)
      const inserted = (result as unknown as Array<{ inserted: boolean }>)[0]?.inserted;
      if (inserted) {
        newCount++;
        newModels.push(m);
        await emitEvent("model_new", `โมเดลใหม่: ${m.name}`, `${m.provider} — ${calcTier(m.context_length).toUpperCase()} ${m.context_length >= 1000 ? Math.round(m.context_length/1000)+"K" : m.context_length} ctx`, m.provider, m.id, "success");
        await logWorker("scan", `🆕 โมเดลใหม่: ${m.name} (${m.provider}) — ${calcTier(m.context_length).toUpperCase()} ${m.context_length >= 1000 ? Math.round(m.context_length/1000)+"K" : m.context_length} ctx`, "success");
      }
    } catch (err) {
      await logWorker("scan", `DB upsert error for ${m.id}: ${err}`, "error");
    }
  }

  // Nickname generation removed — model shown as `provider/model_id` everywhere.

  // ตรวจจับ model ที่หายไป
  let disappearedCount = 0;
  try {
    const recentModels = await sql<{ id: string; name: string; provider: string; last_seen: Date }[]>`
      SELECT id, name, provider, last_seen FROM models
      WHERE last_seen < now() - interval '1 hour'
    `;

    for (const m of recentModels) {
      if (foundIds.has(m.id)) continue;

      const lastSeen = new Date(m.last_seen);
      const hoursAgo = (Date.now() - lastSeen.getTime()) / (1000 * 60 * 60);

      if (hoursAgo >= 48) {
        await logWorker("scan", `💀 หายถาวร: ${m.name} (${m.provider}) — ไม่เจอมา ${Math.round(hoursAgo)} ชม.`, "error");
        disappearedCount++;
      } else if (hoursAgo >= 2) {
        await logWorker("scan", `⚠️ หายชั่วคราว: ${m.name} (${m.provider}) — ไม่เจอมา ${Math.round(hoursAgo)} ชม.`, "warn");
      }
    }
  } catch { /* silent */ }

  const msg = `Scan: พบ ${allModels.length} | OR=${orModels.length} Kilo=${kiloModels.length} GG=${googleModels.length} Groq=${groqModels.length} Cer=${cerebrasModels.length} SN=${sambaNovaModels.length} Mis=${mistralModels.length} Oll=${ollamaModels.length} GH=${githubModels.length} FW=${fireworksModels.length} Coh=${cohereModels.length} CF=${cloudflareModels.length} HF=${hfModels.length} NV=${nvidiaModels.length} Ch=${chutesModels.length} L7=${llm7Models.length} Sc=${scalewayModels.length} Pol=${pollinationsModels.length} OC=${ollamaCloudModels.length} SF=${siliconflowModels.length} GLHF=${glhfModels.length} Tg=${togetherModels.length} Hy=${hyperbolicModels.length} Z=${zaiModels.length} DS=${dashscopeModels.length} Reka=${rekaModels.length} | ใหม่ ${newCount} | หายไป ${disappearedCount}`;
  await logWorker("scan", msg);

  return { found: allModels.length, new: newCount, disappeared: disappearedCount };
}
