import { getRedis } from "./redis";

// Aggressive response cache — เปิด default, TTL 1 ชั่วโมง
// แคชครอบคลุมทุก temperature และ tool requests
// key hash รวม tools + tool_choice เพื่อกัน cross-tool contamination
// ปิดได้ด้วย RESPONSE_CACHE_ENABLED=0

const CACHE_ENABLED = process.env.RESPONSE_CACHE_ENABLED !== "0";
const CACHE_TTL_SEC = 3600;

async function cacheKey(body: Record<string, unknown>): Promise<string> {
  const { createHash } = await import("crypto");
  const messages = body.messages;
  const model = body.model ?? "auto";
  const temperature = body.temperature ?? 0;
  const tools = body.tools ?? null;
  const tool_choice = body.tool_choice ?? null;
  const payload = JSON.stringify({ model, messages, temperature, tools, tool_choice });
  const hash = createHash("sha256").update(payload).digest("hex").slice(0, 32);
  return `respcache:${hash}`;
}

function shouldSkip(body: Record<string, unknown>): boolean {
  if (!CACHE_ENABLED) return true;
  if (body.stream === true) return true;
  return false;
}

export async function getCachedResponse(
  body: Record<string, unknown>,
): Promise<{ content: string; provider: string; model: string } | null> {
  if (shouldSkip(body)) return null;
  try {
    const redis = getRedis();
    const raw = await redis.get(await cacheKey(body));
    if (!raw) return null;
    return JSON.parse(raw) as { content: string; provider: string; model: string };
  } catch {
    return null;
  }
}

export async function setCachedResponse(
  body: Record<string, unknown>,
  response: { content: string; provider: string; model: string },
): Promise<void> {
  if (shouldSkip(body)) return;
  try {
    const redis = getRedis();
    await redis.set(await cacheKey(body), JSON.stringify(response), "EX", CACHE_TTL_SEC);
  } catch {
    // silent — cache is optional
  }
}
