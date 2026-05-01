export interface RequestCaps {
  hasTools: boolean;
  hasImages: boolean;
  needsJsonSchema: boolean;
}

export type RequestIntent =
  | "simple-chat"
  | "tools"
  | "vision"
  | "structured"
  | "long-context"
  | "code"
  | "math"
  | "thai"
  | "general";

export interface RequestProfile {
  intent: RequestIntent;
  complexity: number;
  preferFast: boolean;
  preferStrong: boolean;
  minContext: number;
  retryBudget: number;
  timeoutMs: number;
  hedgeLimit: number;
  tags: string[];
}

export interface CandidateForProfile {
  provider: string;
  model_id: string;
  supports_tools: number;
  supports_vision: number;
  tier: string | null;
  context_length: number | null;
  avg_score: number | null;
  avg_latency: number | null;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function hasThai(text: string): boolean {
  return /[\u0E00-\u0E7F]{3,}/.test(text);
}

function isSimpleChat(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return true;
  if (/^(สวัสดี|หวัดดี|ดี|hello|hi)(\s|[.!?。！？]|$)/i.test(normalized) && /ตอบสั้น|สั้นๆ|สั้น ๆ|ทักทาย/.test(normalized)) {
    return normalized.length <= 80;
  }
  if (normalized.length > 48) return false;
  return /^(hi|hello|hey|ok|okay|thanks?|thank you|why|what|how|สวัสดี|หวัดดี|ดี|โอเค|ขอบคุณ|ทำไม|อะไร|ยังไง|อย่างไร|ครับ|ค่ะ|คับ)[\s.!?。！？]*$/i.test(normalized);
}

export function analyzeRequestProfile(args: {
  caps: RequestCaps;
  userMessage: string;
  estTokens: number;
  mode?: string;
  maxTokens?: unknown;
  temperature?: unknown;
}): RequestProfile {
  const { caps, userMessage, estTokens } = args;
  const text = userMessage.slice(0, 1200);
  const tags: string[] = [];

  let intent: RequestIntent = "general";
  if (caps.hasTools) intent = "tools";
  else if (caps.hasImages) intent = "vision";
  else if (isSimpleChat(text)) intent = "simple-chat";
  else if (caps.needsJsonSchema || /json|schema|structured|ตอบเป็น\s*json/i.test(text)) intent = "structured";
  else if (estTokens > 20_000) intent = "long-context";
  else if (/```|function\s|class\s|def\s|import\s|const\s|interface\s|type\s|sql\b|docker|powershell|typescript|javascript/i.test(text)) intent = "code";
  else if (/\d+\s*[+\-*\/=]\s*\d+|calculate|equation|formula|คำนวณ|สมการ/i.test(text)) intent = "math";
  else if (hasThai(text)) intent = "thai";

  let complexity = 0.25;
  complexity += Math.min(estTokens / 40_000, 0.45);
  if (caps.hasTools) complexity += 0.2;
  if (caps.hasImages) complexity += 0.15;
  if (caps.needsJsonSchema) complexity += 0.15;
  if (/วิเคราะห์|analy[sz]e|compare|เปรียบเทียบ|debug|แก้|deploy|review/i.test(text)) complexity += 0.15;
  complexity = clamp01(complexity);

  const requestedMaxTokens = Number(args.maxTokens ?? 0);
  const lowTemp = Number(args.temperature ?? 0) <= 0.2;
  const preferFast =
    args.mode === "fast" ||
    (intent === "simple-chat" && estTokens < 1200 && requestedMaxTokens <= 512) ||
    (lowTemp && estTokens < 1800 && !caps.hasTools && !caps.hasImages && !caps.needsJsonSchema);
  const preferStrong =
    caps.hasTools ||
    caps.needsJsonSchema ||
    intent === "code" ||
    intent === "math" ||
    intent === "long-context" ||
    complexity >= 0.65;

  const minContext =
    intent === "long-context" ? Math.max(32_000, Math.ceil(estTokens * 1.9)) :
    caps.hasTools ? Math.max(32_000, Math.ceil(estTokens * 1.8)) :
    caps.needsJsonSchema ? Math.max(16_000, Math.ceil(estTokens * 1.6)) :
    Math.max(8_000, Math.ceil(estTokens * 1.4));

  const timeoutMs =
    estTokens > 40_000 ? 120_000 :
    estTokens > 20_000 ? 90_000 :
    estTokens > 10_000 ? 60_000 :
    preferFast ? 20_000 :
    30_000;

  const retryBudget =
    caps.hasTools || caps.needsJsonSchema ? 30 :
    intent === "simple-chat" ? 12 :
    25;

  const hedgeLimit =
    caps.hasTools || caps.needsJsonSchema ? 0 :
    intent === "simple-chat" ? 2 :
    complexity >= 0.65 ? 2 :
    3;

  tags.push(intent);
  if (preferFast) tags.push("prefer-fast");
  if (preferStrong) tags.push("prefer-strong");
  if (hasThai(text)) tags.push("thai");
  if (estTokens > 10_000) tags.push("large-input");

  return { intent, complexity, preferFast, preferStrong, minContext, retryBudget, timeoutMs, hedgeLimit, tags };
}

function tierWeight(tier: string | null): number {
  switch ((tier ?? "").toLowerCase()) {
    case "xlarge": return 4;
    case "large": return 3;
    case "medium": return 2;
    case "small": return 1;
    default: return 1.5;
  }
}

export function scoreCandidateForRequest(c: CandidateForProfile, profile: RequestProfile): number {
  const latency = c.avg_latency && c.avg_latency > 0 ? c.avg_latency : 9999;
  const score = c.avg_score ?? 0;
  const ctx = c.context_length ?? 0;
  const tier = tierWeight(c.tier);
  const model = c.model_id.toLowerCase();
  const provider = c.provider.toLowerCase();

  let weight = score * 120 + tier * 700 - latency / 10;

  if (profile.preferFast) {
    weight += Math.max(0, 8_000 - latency) * 0.9;
    if (tier <= 2) weight += 400;
  }

  if (profile.preferStrong) {
    weight += score * 80 + tier * 900 + Math.min(ctx / 100, 1600);
  }

  if (ctx >= profile.minContext) {
    weight += Math.min((ctx - profile.minContext) / 200, 800);
  } else {
    weight -= Math.min((profile.minContext - ctx) / 20, 5000);
  }

  if (profile.intent === "tools") {
    weight += c.supports_tools === 1 ? 2500 : -10000;
    if (ctx >= 128_000) weight += 900;
    else if (ctx >= 32_000) weight += 450;
  }

  if (profile.intent === "vision") {
    weight += c.supports_vision === 1 ? 2500 : -10000;
    if (["google", "groq", "github"].includes(provider)) weight += 500;
  }

  if (profile.intent === "structured") {
    if (tier >= 3) weight += 1000;
    if (/json|instruct|chat|qwen|gpt|claude|mistral|llama/.test(model)) weight += 250;
  }

  if (profile.intent === "thai") {
    if (/thai|typhoon|openthaigpt/.test(model) || ["thaillm", "typhoon", "dashscope", "zai"].includes(provider)) {
      weight += 1400;
    }
  }

  if (profile.intent === "long-context") {
    weight += Math.min(ctx / 80, 1800);
  }

  if (provider === "ollama" && profile.intent !== "long-context") weight -= 1200;
  return weight;
}

export function rankCandidatesByRequestProfile<T extends CandidateForProfile>(
  candidates: T[],
  profile: RequestProfile,
): T[] {
  return [...candidates].sort((a, b) => scoreCandidateForRequest(b, profile) - scoreCandidateForRequest(a, profile));
}
