import { getRedis } from "./redis";

// MODEL_TPM: per-model token-per-minute limits (Groq free tier per-model limits)
// Provider-level fallback for providers without per-model entries
const MODEL_TPM: Record<string, number> = {
  // Groq — per-model limits (very strict on free tier)
  "groq:llama-3.1-8b-instant":            6_000,
  "groq:llama-3.3-70b-versatile":         12_000,
  "groq:qwen/qwen3-32b":                  6_000,
  "groq:moonshotai/kimi-k2-instruct-0905": 10_000,
  "groq:llama-3.1-70b-versatile":         6_000,
  "groq:gemma2-9b-it":                    6_000,
  "groq:meta-llama/llama-4-scout-17b-16e-instruct": 30_000,
  "groq:meta-llama/llama-4-maverick-17b-128e-instruct": 30_000,
  // Cerebras — per-model limits
  "cerebras:qwen-3-235b-a22b-instruct-2507": 40_000,
  "cerebras:llama-3.3-70b":              60_000,
};

// TPM fallback per provider — Infinity = no hard TPM limit (ให้ provider 429 เองถ้าเกิน)
// เฉพาะ provider ที่มี hard TPM limit จริงๆ ถึงจะตั้งค่า
const PROVIDER_TPM_FALLBACK: Record<string, number> = {
  groq: 30_000,         // strict free tier per-model
  cerebras: 60_000,     // strict free tier
  sambanova: 30_000,    // 30 RPM, limited tokens
  google: 30_000,       // 5-15 RPM, limited TPM
  mistral: Infinity,    // 1B tok/mo, 1 RPS — no hard TPM
  openrouter: Infinity, // per-key, no TPM tracking needed
  nvidia: Infinity,     // credit-based, no TPM
  chutes: Infinity,     // unlimited community GPU
  llm7: Infinity,       // RPM-based, not TPM
  scaleway: Infinity,   // credit-based
  pollinations: Infinity, // no hard limit
  ollamacloud: Infinity,  // per-hour, not per-minute
  siliconflow: Infinity,
  glhf: Infinity,
  together: Infinity,
  hyperbolic: Infinity,
  zai: Infinity,
  dashscope: Infinity,
  reka: Infinity,
  kilo: Infinity,
  ollama: Infinity,     // local
};

const WINDOW_MS = 60_000;

export async function recordTokenConsumption(
  provider: string,
  modelId: string,
  tokens: number,
): Promise<void> {
  if (!tokens || tokens <= 0) return;
  try {
    const redis = getRedis();
    const key = `tpm:${provider}:${modelId}:${Math.floor(Date.now() / WINDOW_MS)}`;
    const pipe = redis.pipeline();
    pipe.incrby(key, tokens);
    pipe.expire(key, 120); // 2 minutes so old buckets rotate naturally
    await pipe.exec();
  } catch {
    // silent — cosmetic
  }
}

export async function hasTpmHeadroom(
  provider: string,
  modelId: string,
  projectedTokens: number,
): Promise<boolean> {
  const limit = MODEL_TPM[`${provider}:${modelId}`] ?? PROVIDER_TPM_FALLBACK[provider];
  if (!limit || limit === Infinity) return true;

  // Hard check: request เดียวใหญ่กว่า limit เต็ม → ไม่มีทาง fit → skip
  if (projectedTokens > limit) {
    console.log(`[TPM-HARD] ${provider}/${modelId} request ${projectedTokens} > limit ${limit}`);
    return false;
  }

  try {
    const redis = getRedis();
    const key = `tpm:${provider}:${modelId}:${Math.floor(Date.now() / WINDOW_MS)}`;
    const raw = await redis.get(key);
    const consumed = Number(raw ?? 0);
    const projected = consumed + projectedTokens;
    // Soft cap 100% (เดิม 90% ตึงเกินไป) — ให้ลองเต็ม limit ถ้า consumed ยังพอ
    // provider จะ return 429 ถ้าเกินจริง ซึ่งระบบจะเรียนรู้ผ่าน parseLimitError
    const hasRoom = projected <= limit;
    if (!hasRoom) {
      console.log(`[TPM-SKIP] ${provider}/${modelId} ${consumed}+${projectedTokens}=${projected} > ${limit}`);
    }
    return hasRoom;
  } catch {
    return true; // Redis down → allow
  }
}
