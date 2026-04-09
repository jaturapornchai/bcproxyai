import { getRedis } from "./redis";

// Hardcoded TPM limits per provider (conservative estimates from free tiers).
// These are per-provider aggregate, not per-model. If a provider has multiple
// models they share this budget.
const PROVIDER_TPM: Record<string, number> = {
  groq: 30_000,        // conservative free tier estimate
  cerebras: 60_000,
  mistral: 60_000,
  openrouter: 100_000, // mostly unlimited per key
  sambanova: 10_000,
  kilo: 20_000,
  ollama: Infinity,    // local, no limit
  google: 15_000,
};

const WINDOW_MS = 60_000;

export async function recordTokenConsumption(
  provider: string,
  tokens: number,
): Promise<void> {
  if (!tokens || tokens <= 0) return;
  try {
    const redis = getRedis();
    const key = `tpm:${provider}:${Math.floor(Date.now() / WINDOW_MS)}`;
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
  projectedTokens: number,
): Promise<boolean> {
  const limit = PROVIDER_TPM[provider];
  if (!limit || limit === Infinity) return true;
  try {
    const redis = getRedis();
    const key = `tpm:${provider}:${Math.floor(Date.now() / WINDOW_MS)}`;
    const raw = await redis.get(key);
    const consumed = Number(raw ?? 0);
    const projected = consumed + projectedTokens;
    const hasRoom = projected <= limit * 0.9; // leave 10% safety margin
    if (!hasRoom) {
      console.log(`[TPM-SKIP] ${provider} ${consumed}+${projectedTokens}=${projected} > ${limit} (90% cap)`);
    }
    return hasRoom;
  } catch {
    return true; // Redis down → allow
  }
}
