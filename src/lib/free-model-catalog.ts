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
}

function tierFor(contextLength: number): FreeModelCatalogEntry["tier"] {
  if (contextLength >= 128000) return "large";
  if (contextLength >= 32000) return "medium";
  return "small";
}

function openrouter(
  modelId: string,
  name: string,
  contextLength: number,
  caps: {
    tools?: boolean;
    vision?: boolean;
    reasoning?: boolean;
    json?: boolean;
    code?: boolean;
  } = {},
): FreeModelCatalogEntry {
  return {
    provider: "openrouter",
    modelId,
    name,
    contextLength,
    tier: tierFor(contextLength),
    supportsTools: caps.tools ?? false,
    supportsVision: caps.vision ?? false,
    supportsReasoning: caps.reasoning ?? false,
    supportsJsonMode: caps.json ?? false,
    supportsCode: caps.code ?? /coder|code|poolside|laguna/i.test(modelId),
  };
}

// Hardcoded no-spend catalog. Local models, provider-wide free lists, and
// router aliases such as openrouter/free are intentionally excluded.
export const FREE_MODEL_CATALOG: readonly FreeModelCatalogEntry[] = [
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
] as const;

const FREE_MODEL_KEYS = new Set(
  FREE_MODEL_CATALOG.map((m) => `${m.provider}/${m.modelId}`.toLowerCase()),
);

export function getHardcodedFreeModelRules(): string[] {
  return FREE_MODEL_CATALOG.map((m) => `${m.provider}/${m.modelId}`);
}

export function getHardcodedFreeProviders(): string[] {
  return [...new Set(FREE_MODEL_CATALOG.map((m) => m.provider))];
}

export function isHardcodedFreeModel(provider: string, modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  return FREE_MODEL_KEYS.has(`${provider}/${modelId}`.toLowerCase());
}
