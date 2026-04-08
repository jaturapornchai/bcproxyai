import { getSqlClient } from "@/lib/db/schema";
import { getNextApiKey } from "@/lib/api-keys";
import { emitEvent } from "@/lib/routing-learn";
import { upstreamAgent } from "@/lib/upstream-agent";

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
  /vision/i, /llava/i, /gemini/i, /gemma[34]/i, /gemma.*it/i, /pixtral/i,
  /gpt-4o/i, /gpt-4-turbo/i, /claude/i, /qwen.*vl/i, /qwen2\.5-vl/i,
  /qwen3/i, /internvl/i, /minicpm.*v/i, /cogvlm/i, /phi-3.*vision/i,
  /deepseek-vl/i, /llama-3\.2.*vision/i, /llama-4/i,
  /molmo/i, /moondream/i, /bakllava/i,
];

const TOOLS_PATTERNS = [
  /gemini/i, /gpt-4/i, /gpt-3\.5/i, /claude/i, /mistral.*large/i,
  /mistral.*medium/i, /mixtral/i, /command-r/i, /qwen/i, /llama-3/i,
  /llama-4/i, /deepseek/i, /hermes/i, /firefunction/i, /gorilla/i,
  /nexusraven/i, /functionary/i, /gemma/i,
];

const REASONING_PATTERNS = [
  /deepseek-r1/i, /\bo[13]\b/i, /o1-/i, /o3-/i, /qwq/i, /reasoning/i,
  /think/i, /magistral/i, /r1-distill/i,
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

function detectCaps(modelId: string, name: string): Partial<ModelRow> {
  const combined = `${modelId} ${name}`;
  return {
    supports_reasoning: REASONING_PATTERNS.some(p => p.test(combined)) ? 1 : 0,
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
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${getNextApiKey("openrouter")}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models: ModelRow[] = [];
    for (const m of json.data ?? []) {
      if (m.pricing?.prompt !== "0") continue;
      const ctx = m.context_length ?? 0;
      const arch = m.architecture ?? {};
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
      });
    }
    return models;
  } catch (err) {
    await logWorker("scan", `OpenRouter fetch error: ${err}`, "error");
    return [];
  }
}

async function fetchKiloModels(): Promise<ModelRow[]> {
  try {
    const headers: Record<string, string> = {};
    const kiloKey = getNextApiKey("kilo");
    if (kiloKey) headers["Authorization"] = `Bearer ${kiloKey}`;
    const res = await fetch("https://api.kilo.ai/api/gateway/models", {
      headers,
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
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${getNextApiKey("google")}`;
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
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${getNextApiKey("groq")}` },
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
    for (const m of json.data ?? []) {
      const mid: string = m.id ?? "";
      if (NON_CHAT_KEYWORDS.some((kw) => mid.toLowerCase().includes(kw))) continue;
      const ctx = m.context_window ?? m.context_length ?? m.max_context_length ?? 0;
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

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? "";

export async function generateNickname(modelName: string, provider: string, existingNames: string[], scoreInfo = ""): Promise<string | null> {
  if (!DEEPSEEK_API_KEY) return null;
  try {
    const avoid = existingNames.length > 0 ? `\nห้ามใช้ชื่อเหล่านี้: ${existingNames.slice(-30).join(", ")}` : "";
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{
          role: "user",
          content: `ตั้งชื่อเล่นภาษาไทยตลกๆ น่ารัก ให้ AI model ชื่อ "${modelName}" จาก ${provider}${scoreInfo} ตอบแค่ชื่อเดียว สั้นๆ 2-4 คำ ห้ามใส่เครื่องหมายคำพูด ห้ามอธิบาย${avoid}`,
        }],
        max_tokens: 30,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const name = (json.choices?.[0]?.message?.content ?? "")
      .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
      .replace(/["'`]/g, "")
      .trim()
      .split("\n")[0]
      .slice(0, 30);
    return name || null;
  } catch {
    return null;
  }
}

export async function scanModels(): Promise<{ found: number; new: number; disappeared: number }> {
  await logWorker("scan", "Starting model scan");
  const sql = getSqlClient();

  const [orModels, kiloModels, googleModels, groqModels, cerebrasModels, sambaNovaModels, mistralModels, ollamaModels, githubModels, fireworksModels, cohereModels, cloudflareModels, hfModels] = await Promise.all([
    fetchOpenRouterModels(),
    fetchKiloModels(),
    fetchGoogleModels(),
    fetchGroqModels(),
    fetchCerebrasModels(),
    fetchSambaNovaModels(),
    fetchMistralModels(),
    fetchOllamaModels(),
    fetchGitHubModels(),
    fetchFireworksModels(),
    fetchCohereModels(),
    fetchCloudflareModels(),
    fetchHuggingFaceModels(),
  ]);

  const allModels = [...orModels, ...kiloModels, ...googleModels, ...groqModels, ...cerebrasModels, ...sambaNovaModels, ...mistralModels, ...ollamaModels, ...githubModels, ...fireworksModels, ...cohereModels, ...cloudflareModels, ...hfModels];
  const foundIds = new Set(allModels.map(m => m.id));
  let newCount = 0;

  const newModels: ModelRow[] = [];

  // Upsert models one at a time (postgres tagged templates don't support batch upsert cleanly)
  for (const m of allModels) {
    const caps = detectCaps(m.model_id, m.name);
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

  // ให้ DeepSeek ตั้งชื่อเล่นให้โมเดลที่ยังไม่มี nickname (max 10 ต่อรอบ ประหยัด token)
  if (DEEPSEEK_API_KEY) {
    const unnamed = await sql<{ id: string; name: string; provider: string }[]>`
      SELECT id, name, provider FROM models WHERE nickname IS NULL AND context_length >= 32000 LIMIT 10
    `;

    if (unnamed.length > 0) {
      const existingNicknameRows = await sql<{ nickname: string }[]>`
        SELECT nickname FROM models WHERE nickname IS NOT NULL
      `;
      const existingNicknames = existingNicknameRows.map(r => r.nickname);

      for (const m of unnamed) {
        const nickname = await generateNickname(m.name, m.provider, existingNicknames);
        if (nickname && !existingNicknames.includes(nickname)) {
          try {
            await sql`UPDATE models SET nickname = ${nickname} WHERE id = ${m.id}`;
            existingNicknames.push(nickname);
            await logWorker("scan", `🎭 ตั้งชื่อ: ${m.name} → "${nickname}"`, "success");
          } catch { /* silent */ }
        }
      }
    }
  }

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

  const msg = `Scan: พบ ${allModels.length} (OR=${orModels.length}, Kilo=${kiloModels.length}, Google=${googleModels.length}, Groq=${groqModels.length}, Cerebras=${cerebrasModels.length}, SN=${sambaNovaModels.length}, Mistral=${mistralModels.length}, Ollama=${ollamaModels.length}, GitHub=${githubModels.length}, FW=${fireworksModels.length}, Cohere=${cohereModels.length}, CF=${cloudflareModels.length}, HF=${hfModels.length}) | ใหม่ ${newCount} | หายไป ${disappearedCount}`;
  await logWorker("scan", msg);

  return { found: allModels.length, new: newCount, disappeared: disappearedCount };
}
