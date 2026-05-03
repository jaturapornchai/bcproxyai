export interface FreeModelCatalogEntry {
  provider: string;
  modelId: string;
  name: string;
  contextLength: number;
  tier: "small" | "medium" | "large";
  supportsTools: boolean;
  supportsVision: boolean;
  supportsReasoning: boolean;
  supportsJsonMode: boolean;
  supportsCode?: boolean;
  /** ISO date 'YYYY-MM-DD'. Filtered out from /v1/models on/after this day; warned 7 days before. */
  deprecatedAfter?: string;
  /** Approximate provider-side requests-per-minute limit. Used for client-side throttle. */
  rpmLimit?: number;
}

function tierFor(contextLength: number): FreeModelCatalogEntry["tier"] {
  if (contextLength >= 128000) return "large";
  if (contextLength >= 32000) return "medium";
  return "small";
}

interface ModelCaps {
  tools?: boolean;
  vision?: boolean;
  reasoning?: boolean;
  json?: boolean;
  code?: boolean;
}

// Conservative provider-wide RPM defaults per documented free-tier limits.
// Per-model overrides on the entry win; otherwise this default applies.
const PROVIDER_DEFAULT_RPM: Record<string, number> = {
  groq: 30,
  cerebras: 30,
  google: 15,
  github: 15,
  sambanova: 30,
  mistral: 60,
  cohere: 1, // trial key cap is 1000 calls/MONTH; throttle aggressively
  huggingface: 30,
  nvidia: 40,
  together: 60,
  chutes: 60,
  ollamacloud: 60,
  typhoon: 200,
  thaillm: 200,
  sealion: 10,
  openrouter: 60,
};

function entry(
  provider: string,
  modelId: string,
  name: string,
  contextLength: number,
  caps: ModelCaps = {},
): FreeModelCatalogEntry {
  return {
    provider,
    modelId,
    name,
    contextLength,
    tier: tierFor(contextLength),
    supportsTools: caps.tools ?? false,
    supportsVision: caps.vision ?? false,
    supportsReasoning: caps.reasoning ?? false,
    supportsJsonMode: caps.json ?? false,
    supportsCode: caps.code ?? /coder|code|poolside|laguna/i.test(modelId),
    rpmLimit: PROVIDER_DEFAULT_RPM[provider],
  };
}

export function getRpmLimit(provider: string, modelId: string): number | undefined {
  const e = FREE_MODEL_CATALOG.find(
    (m) => m.provider === provider && m.modelId === modelId,
  );
  return e?.rpmLimit ?? PROVIDER_DEFAULT_RPM[provider];
}

const openrouter = (m: string, n: string, c: number, caps: ModelCaps = {}) => entry("openrouter", m, n, c, caps);
const groq = (m: string, n: string, c: number, caps: ModelCaps = {}) => entry("groq", m, n, c, caps);
const cerebras = (m: string, n: string, c: number, caps: ModelCaps = {}) => entry("cerebras", m, n, c, caps);
const google = (m: string, n: string, c: number, caps: ModelCaps = {}) => entry("google", m, n, c, caps);
const github = (m: string, n: string, c: number, caps: ModelCaps = {}) => entry("github", m, n, c, caps);
const sambanova = (m: string, n: string, c: number, caps: ModelCaps = {}) => entry("sambanova", m, n, c, caps);
const mistral = (m: string, n: string, c: number, caps: ModelCaps = {}) => entry("mistral", m, n, c, caps);
const cohere = (m: string, n: string, c: number, caps: ModelCaps = {}) => entry("cohere", m, n, c, caps);
const huggingface = (m: string, n: string, c: number, caps: ModelCaps = {}) => entry("huggingface", m, n, c, caps);
const nvidia = (m: string, n: string, c: number, caps: ModelCaps = {}) => entry("nvidia", m, n, c, caps);
const together = (m: string, n: string, c: number, caps: ModelCaps = {}) => entry("together", m, n, c, caps);
const chutes = (m: string, n: string, c: number, caps: ModelCaps = {}) => entry("chutes", m, n, c, caps);
const ollamacloud = (m: string, n: string, c: number, caps: ModelCaps = {}) => entry("ollamacloud", m, n, c, caps);
const typhoon = (m: string, n: string, c: number, caps: ModelCaps = {}) => entry("typhoon", m, n, c, caps);
const thaillm = (m: string, n: string, c: number, caps: ModelCaps = {}) => entry("thaillm", m, n, c, caps);
const sealion = (m: string, n: string, c: number, caps: ModelCaps = {}) => entry("sealion", m, n, c, caps);

// Hardcoded zero-spend catalog. Each entry must come from a provider that
// publishes a real free tier (rate-limited but not credit-trial). Local
// models, provider-wide free lists, and router aliases such as
// openrouter/free are intentionally excluded. Cloudflare Workers AI is
// excluded because its endpoint requires CLOUDFLARE_ACCOUNT_ID baked into
// the URL, which is incompatible with the per-provider key lookup model.
export const FREE_MODEL_CATALOG: readonly FreeModelCatalogEntry[] = [
  // ── OpenRouter :free models (no charge regardless of provider routing) ──
  openrouter("openai/gpt-oss-20b:free", "OpenAI: gpt-oss-20b (free)", 131072, { tools: true, reasoning: true }),
  openrouter("openai/gpt-oss-120b:free", "OpenAI: gpt-oss-120b (free)", 131072, { tools: true, reasoning: true }),
  openrouter("qwen/qwen3-coder:free", "Qwen: Qwen3 Coder 480B A35B (free)", 262000, { tools: true, code: true }),
  openrouter("qwen/qwen3-next-80b-a3b-instruct:free", "Qwen: Qwen3 Next 80B A3B Instruct (free)", 262144, { tools: true, json: true }),
  openrouter("z-ai/glm-4.5-air:free", "Z.ai: GLM 4.5 Air (free)", 131072, { tools: true, reasoning: true }),
  openrouter("meta-llama/llama-3.3-70b-instruct:free", "Meta: Llama 3.3 70B Instruct (free)", 65536, { tools: true }),
  openrouter("meta-llama/llama-3.2-3b-instruct:free", "Meta: Llama 3.2 3B Instruct (free)", 131072),
  openrouter("nousresearch/hermes-3-llama-3.1-405b:free", "Nous: Hermes 3 405B Instruct (free)", 131072),
  openrouter("nvidia/nemotron-3-super-120b-a12b:free", "NVIDIA: Nemotron 3 Super (free)", 262144, { tools: true, reasoning: true, json: true }),
  openrouter("nvidia/nemotron-3-nano-30b-a3b:free", "NVIDIA: Nemotron 3 Nano 30B A3B (free)", 256000, { tools: true, reasoning: true }),
  openrouter("nvidia/nemotron-nano-9b-v2:free", "NVIDIA: Nemotron Nano 9B V2 (free)", 128000, { tools: true, reasoning: true, json: true }),
  openrouter("nvidia/nemotron-nano-12b-v2-vl:free", "NVIDIA: Nemotron Nano 12B 2 VL (free)", 128000, { tools: true, vision: true, reasoning: true }),
  openrouter("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", "NVIDIA: Nemotron 3 Nano Omni (free)", 256000, { tools: true, vision: true, reasoning: true }),
  openrouter("google/gemma-4-31b-it:free", "Google: Gemma 4 31B (free)", 262144, { tools: true, vision: true, reasoning: true, json: true }),
  openrouter("google/gemma-4-26b-a4b-it:free", "Google: Gemma 4 26B A4B (free)", 262144, { tools: true, vision: true, reasoning: true, json: true }),
  openrouter("google/gemma-3-27b-it:free", "Google: Gemma 3 27B (free)", 131072, { vision: true, json: true }),
  openrouter("google/gemma-3-12b-it:free", "Google: Gemma 3 12B (free)", 32768, { vision: true }),
  openrouter("google/gemma-3-4b-it:free", "Google: Gemma 3 4B (free)", 32768, { vision: true, json: true }),
  openrouter("minimax/minimax-m2.5:free", "MiniMax: MiniMax M2.5 (free)", 196608, { tools: true, reasoning: true, json: true }),
  openrouter("inclusionai/ling-2.6-1t:free", "inclusionAI: Ling-2.6-1T (free)", 262144, { tools: true, json: true }),
  openrouter("tencent/hy3-preview:free", "Tencent: Hy3 preview (free)", 262144, { tools: true, reasoning: true }),
  openrouter("poolside/laguna-m.1:free", "Poolside: Laguna M.1 (free)", 131072, { tools: true, reasoning: true, code: true }),
  openrouter("poolside/laguna-xs.2:free", "Poolside: Laguna XS.2 (free)", 131072, { tools: true, reasoning: true, code: true }),
  openrouter("baidu/qianfan-ocr-fast:free", "Baidu: Qianfan-OCR-Fast (free)", 65536, { vision: true, reasoning: true }),
  openrouter("liquid/lfm-2.5-1.2b-thinking:free", "LiquidAI: LFM2.5-1.2B-Thinking (free)", 32768, { reasoning: true }),
  openrouter("liquid/lfm-2.5-1.2b-instruct:free", "LiquidAI: LFM2.5-1.2B-Instruct (free)", 32768),
  openrouter("cognitivecomputations/dolphin-mistral-24b-venice-edition:free", "Venice: Uncensored (free)", 32768, { json: true }),
  openrouter("google/gemma-3n-e4b-it:free", "Google: Gemma 3n 4B (free)", 8192, { json: true }),
  openrouter("google/gemma-3n-e2b-it:free", "Google: Gemma 3n 2B (free)", 8192, { json: true }),

  // ── Groq (free tier: 30 RPM / 1K-14K RPD, no billing required) ──
  groq("llama-3.3-70b-versatile", "Groq: Llama 3.3 70B Versatile", 131072, { tools: true, json: true }),
  groq("llama-3.1-8b-instant", "Groq: Llama 3.1 8B Instant", 131072, { tools: true, json: true }),
  groq("meta-llama/llama-4-scout-17b-16e-instruct", "Groq: Llama 4 Scout 17B 16E", 131072, { tools: true, vision: true, json: true }),
  groq("openai/gpt-oss-120b", "Groq: gpt-oss-120b", 131072, { tools: true, reasoning: true, json: true }),
  groq("openai/gpt-oss-20b", "Groq: gpt-oss-20b", 131072, { tools: true, reasoning: true, json: true }),
  groq("qwen/qwen3-32b", "Groq: Qwen 3 32B", 131072, { tools: true, reasoning: true, json: true }),

  // ── Cerebras (free tier: 1M tok/day, context capped at 8K) ──
  { ...cerebras("llama-3.3-70b", "Cerebras: Llama 3.3 70B", 8192, { tools: true, json: true }), deprecatedAfter: "2026-02-16" },
  cerebras("qwen-3-32b", "Cerebras: Qwen 3 32B", 8192, { tools: true, json: true }),
  { ...cerebras("qwen-3-235b-a22b-instruct-2507", "Cerebras: Qwen 3 235B Instruct", 8192, { tools: true, json: true }), deprecatedAfter: "2026-05-27" },
  cerebras("qwen-3-235b-a22b-thinking-2507", "Cerebras: Qwen 3 235B Thinking", 8192, { tools: true, reasoning: true }),
  cerebras("gpt-oss-120b", "Cerebras: gpt-oss-120b", 8192, { tools: true, reasoning: true, json: true }),

  // ── Google AI Studio (Gemini free tier: 5-15 RPM, 1500 req/day Flash) ──
  google("gemini-2.5-pro", "Google: Gemini 2.5 Pro", 1048576, { tools: true, vision: true, reasoning: true, json: true }),
  google("gemini-2.5-flash", "Google: Gemini 2.5 Flash", 1048576, { tools: true, vision: true, reasoning: true, json: true }),
  google("gemini-2.5-flash-lite", "Google: Gemini 2.5 Flash Lite", 1048576, { tools: true, vision: true, json: true }),
  google("gemini-2.0-flash", "Google: Gemini 2.0 Flash", 1048576, { tools: true, vision: true, json: true }),
  google("gemini-2.0-flash-lite", "Google: Gemini 2.0 Flash Lite", 1048576, { tools: true, vision: true, json: true }),
  google("gemma-3-27b-it", "Google: Gemma 3 27B IT", 131072, { json: true }),
  google("gemma-3-12b-it", "Google: Gemma 3 12B IT", 131072, { json: true }),

  // ── GitHub Models (free preview, rate-limited per Microsoft account) ──
  github("openai/gpt-4o-mini", "GitHub: GPT-4o mini", 128000, { tools: true, vision: true, json: true }),
  github("openai/gpt-4o", "GitHub: GPT-4o", 128000, { tools: true, vision: true, json: true }),
  github("openai/gpt-4.1", "GitHub: GPT-4.1", 1047576, { tools: true, vision: true, json: true }),
  github("openai/gpt-4.1-mini", "GitHub: GPT-4.1 mini", 1047576, { tools: true, vision: true, json: true }),
  github("openai/gpt-4.1-nano", "GitHub: GPT-4.1 nano", 1047576, { tools: true, vision: true, json: true }),
  github("openai/o1-mini", "GitHub: o1-mini", 128000, { reasoning: true }),
  github("openai/o3-mini", "GitHub: o3-mini", 200000, { reasoning: true, json: true }),
  github("openai/o4-mini", "GitHub: o4-mini", 200000, { tools: true, reasoning: true, json: true }),
  github("meta/Llama-3.3-70B-Instruct", "GitHub: Llama 3.3 70B Instruct", 131072, { tools: true, json: true }),
  github("meta/Llama-4-Scout-17B-16E-Instruct", "GitHub: Llama 4 Scout 17B", 131072, { tools: true, vision: true, json: true }),
  github("microsoft/Phi-4", "GitHub: Phi-4", 16384, { tools: true, json: true }),
  github("microsoft/Phi-4-multimodal-instruct", "GitHub: Phi-4 Multimodal", 131072, { vision: true, json: true }),
  github("microsoft/Phi-3.5-mini-instruct", "GitHub: Phi-3.5 mini Instruct", 131072, { tools: true, json: true }),
  github("xai/grok-3-mini", "GitHub: Grok-3 mini", 131072, { tools: true, reasoning: true, json: true }),
  github("xai/grok-code-fast-1", "GitHub: Grok Code Fast 1", 256000, { tools: true, json: true, code: true }),
  github("mistral-ai/Mistral-Nemo", "GitHub: Mistral Nemo", 131072, { tools: true, json: true }),
  github("mistral-ai/Codestral-2501", "GitHub: Codestral 2501", 262144, { code: true, json: true }),
  github("cohere/cohere-command-r-plus-08-2024", "GitHub: Cohere Command R+", 128000, { tools: true, json: true }),
  github("deepseek/DeepSeek-V3-0324", "GitHub: DeepSeek V3 0324", 131072, { tools: true, json: true }),
  github("deepseek/DeepSeek-R1", "GitHub: DeepSeek R1", 131072, { reasoning: true }),

  // ── SambaNova (free tier: 10-30 RPM, daily quota per model) ──
  sambanova("Meta-Llama-3.3-70B-Instruct", "SambaNova: Llama 3.3 70B", 131072, { tools: true, json: true }),
  sambanova("Meta-Llama-3.1-8B-Instruct", "SambaNova: Llama 3.1 8B", 16384, { tools: true, json: true }),
  sambanova("Meta-Llama-3.1-405B-Instruct", "SambaNova: Llama 3.1 405B", 16384, { tools: true, json: true }),
  sambanova("Meta-Llama-3.2-3B-Instruct", "SambaNova: Llama 3.2 3B", 8192, { tools: true, json: true }),
  sambanova("Llama-4-Maverick-17B-128E-Instruct", "SambaNova: Llama 4 Maverick", 131072, { tools: true, vision: true, json: true }),
  sambanova("Llama-4-Scout-17B-16E-Instruct", "SambaNova: Llama 4 Scout", 131072, { tools: true, vision: true, json: true }),
  sambanova("DeepSeek-R1", "SambaNova: DeepSeek R1", 16384, { reasoning: true }),
  sambanova("DeepSeek-R1-Distill-Llama-70B", "SambaNova: R1 Distill Llama 70B", 131072, { reasoning: true }),
  sambanova("DeepSeek-V3-0324", "SambaNova: DeepSeek V3 0324", 16384, { tools: true, json: true }),
  sambanova("Qwen3-32B", "SambaNova: Qwen 3 32B", 16384, { tools: true, reasoning: true, json: true }),
  sambanova("QwQ-32B", "SambaNova: QwQ 32B", 16384, { reasoning: true }),
  sambanova("gpt-oss-120b", "SambaNova: gpt-oss-120b", 131072, { tools: true, reasoning: true, json: true }),

  // ── Mistral La Plateforme (Free Experiment tier: 1G tok/month, all models) ──
  mistral("open-mistral-nemo", "Mistral: Nemo 12B", 131072, { tools: true, json: true }),
  mistral("mistral-small-latest", "Mistral: Small 3.2 24B", 131072, { tools: true, vision: true, json: true }),
  mistral("ministral-8b-latest", "Mistral: Ministral 8B", 131072, { tools: true, json: true }),
  mistral("ministral-3b-latest", "Mistral: Ministral 3B", 131072, { tools: true, json: true }),
  mistral("codestral-latest", "Mistral: Codestral", 262144, { code: true, json: true }),
  mistral("open-mixtral-8x22b", "Mistral: Mixtral 8x22B", 65536, { tools: true, json: true }),

  // ── Cohere (trial key: 1K calls/month, non-commercial) ──
  cohere("command-a-03-2025", "Cohere: Command A", 256000, { tools: true, json: true }),
  cohere("command-r-plus", "Cohere: Command R+", 128000, { tools: true, json: true }),
  cohere("command-r", "Cohere: Command R", 128000, { tools: true, json: true }),
  cohere("command-r7b", "Cohere: Command R7B", 128000, { tools: true, json: true }),

  // ── HuggingFace Inference Router (monthly free credits) ──
  huggingface("meta-llama/Llama-3.3-70B-Instruct", "HF: Llama 3.3 70B", 131072, { tools: true, json: true }),
  huggingface("meta-llama/Llama-3.1-8B-Instruct", "HF: Llama 3.1 8B", 131072, { tools: true, json: true }),
  huggingface("Qwen/Qwen3-32B", "HF: Qwen 3 32B", 131072, { tools: true, reasoning: true, json: true }),
  huggingface("deepseek-ai/DeepSeek-R1", "HF: DeepSeek R1", 131072, { reasoning: true }),
  huggingface("openai/gpt-oss-120b", "HF: gpt-oss-120b", 131072, { tools: true, reasoning: true }),
  huggingface("moonshotai/Kimi-K2-Instruct-0905", "HF: Kimi K2 0905", 262144, { tools: true, code: true }),

  // ── NVIDIA NIM (~40 RPM, free starter credits) ──
  nvidia("meta/llama-3.3-70b-instruct", "NVIDIA: Llama 3.3 70B", 131072, { tools: true, json: true }),
  nvidia("meta/llama-3.1-405b-instruct", "NVIDIA: Llama 3.1 405B", 131072, { tools: true, json: true }),
  nvidia("meta/llama-4-scout-17b-16e-instruct", "NVIDIA: Llama 4 Scout", 131072, { tools: true, vision: true, json: true }),
  nvidia("meta/llama-4-maverick-17b-128e-instruct", "NVIDIA: Llama 4 Maverick", 131072, { tools: true, vision: true, json: true }),
  nvidia("deepseek-ai/deepseek-r1", "NVIDIA: DeepSeek R1", 131072, { reasoning: true }),
  nvidia("nvidia/llama-3.3-nemotron-super-49b-v1", "NVIDIA: Nemotron Super 49B", 131072, { tools: true, reasoning: true }),
  nvidia("openai/gpt-oss-120b", "NVIDIA: gpt-oss-120b", 131072, { tools: true, reasoning: true, json: true }),

  // ── Together AI (only the explicitly Free endpoints) ──
  together("meta-llama/Llama-3.3-70B-Instruct-Turbo-Free", "Together: Llama 3.3 70B Free", 131072, { tools: true, json: true }),
  together("meta-llama/Llama-Vision-Free", "Together: Llama 3.2 11B Vision Free", 131072, { vision: true, json: true }),

  // ── Chutes AI removed: production probe revealed it is not actually free.
  //    The endpoint demands paying the account balance with TAO crypto
  //    ("Quota exceeded and account balance is $0.0, please pay with fiat or
  //    send tao to ..."), and several model_ids 404 outright.

  // ── Ollama Cloud (free tier: daily quota, requires API key) ──
  ollamacloud("gpt-oss:120b-cloud", "OllamaCloud: gpt-oss 120B", 131072, { tools: true, reasoning: true, json: true }),
  ollamacloud("gpt-oss:20b-cloud", "OllamaCloud: gpt-oss 20B", 131072, { tools: true, reasoning: true, json: true }),
  ollamacloud("deepseek-v3.1:671b-cloud", "OllamaCloud: DeepSeek V3.1 671B", 131072, { tools: true, json: true }),
  ollamacloud("qwen3-coder:480b-cloud", "OllamaCloud: Qwen 3 Coder 480B", 262144, { code: true, tools: true, json: true }),
  ollamacloud("kimi-k2:1t-cloud", "OllamaCloud: Kimi K2 1T", 262144, { tools: true, json: true }),

  // ── Typhoon (SCB 10X Thai LLM, free 5 RPS / 200 RPM, no card required) ──
  typhoon("typhoon-v2.5-30b-a3b-instruct", "Typhoon: V2.5 30B A3B Instruct (TH)", 8192, { tools: true, json: true }),
  typhoon("typhoon-v2.1-12b-instruct", "Typhoon: V2.1 12B Instruct (TH)", 8192, { tools: true, json: true }),

  // ── ThaiLLM (NECTEC consortium, free launch period, no card required) ──
  thaillm("openthaigpt-thaillm-8b-instruct-v7.2", "ThaiLLM: OpenThaiGPT 8B Instruct v7.2", 8192, { tools: true, json: true }),
  thaillm("typhoon-s-thaillm-8b-instruct", "ThaiLLM: Typhoon-S 8B Instruct", 8192, { tools: true, json: true }),
  thaillm("pathumma-thaillm-qwen3-8b-think-2.0.0", "ThaiLLM: Pathumma Qwen3 8B Thinking", 8192, { tools: true, reasoning: true, json: true }),
  thaillm("thalle-0.2-thaillm-8b-fa", "ThaiLLM: Thalle 0.2 8B (Finance)", 8192, { tools: true, json: true }),

  // ── SEA-LION (AI Singapore, free trial, no card required, 10 RPM/user) ──
  sealion("aisingapore/Gemma-SEA-LION-v4-27B-IT", "SEA-LION: Gemma v4 27B IT", 8192, { tools: true, vision: true, json: true }),
  sealion("aisingapore/Qwen-SEA-LION-v4-32B-IT", "SEA-LION: Qwen v4 32B IT", 8192, { tools: true, json: true }),
  sealion("aisingapore/Llama-SEA-LION-v3.5-70B-R", "SEA-LION: Llama v3.5 70B Reasoning", 8192, { reasoning: true, json: true }),
] as const;

const FREE_MODEL_KEYS = new Set(
  FREE_MODEL_CATALOG.map((m) => `${m.provider}/${m.modelId}`.toLowerCase()),
);

const DEPRECATION_WARN_DAYS = 7;
const MS_PER_DAY = 86_400_000;

export function isModelDeprecated(entry: FreeModelCatalogEntry, now = Date.now()): boolean {
  if (!entry.deprecatedAfter) return false;
  const t = Date.parse(entry.deprecatedAfter);
  return Number.isFinite(t) && t <= now;
}

export function daysUntilDeprecation(entry: FreeModelCatalogEntry, now = Date.now()): number | null {
  if (!entry.deprecatedAfter) return null;
  const t = Date.parse(entry.deprecatedAfter);
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - now) / MS_PER_DAY);
}

/** Catalog with EOL models filtered out — use this for serving / routing. */
export function getActiveFreeModelCatalog(now = Date.now()): FreeModelCatalogEntry[] {
  return FREE_MODEL_CATALOG.filter((m) => !isModelDeprecated(m, now));
}

/** Models within DEPRECATION_WARN_DAYS of EOL — surface in worker logs. */
export function getModelsDeprecatingSoon(now = Date.now()): Array<{ entry: FreeModelCatalogEntry; daysLeft: number }> {
  const out: Array<{ entry: FreeModelCatalogEntry; daysLeft: number }> = [];
  for (const m of FREE_MODEL_CATALOG) {
    const d = daysUntilDeprecation(m, now);
    if (d !== null && d > 0 && d <= DEPRECATION_WARN_DAYS) out.push({ entry: m, daysLeft: d });
  }
  return out;
}

export function getHardcodedFreeModelRules(): string[] {
  return getActiveFreeModelCatalog().map((m) => `${m.provider}/${m.modelId}`);
}

export function getHardcodedFreeProviders(): string[] {
  return [...new Set(getActiveFreeModelCatalog().map((m) => m.provider))];
}

export function isHardcodedFreeModel(provider: string, modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  const key = `${provider}/${modelId}`.toLowerCase();
  if (!FREE_MODEL_KEYS.has(key)) return false;
  // Reject deprecated models even if listed
  const entry = FREE_MODEL_CATALOG.find(
    (m) => `${m.provider}/${m.modelId}`.toLowerCase() === key,
  );
  return entry ? !isModelDeprecated(entry) : false;
}
