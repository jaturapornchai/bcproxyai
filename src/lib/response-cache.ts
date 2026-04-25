import { createHash } from "node:crypto";
import { getRedis } from "./redis";

// Response cache — TTL 1h. Keyed by (apiKey, body-hash) so tenants don't see
// each other's cached responses. Skipped for streaming, tool calls, and any
// request that opts out via X-No-Cache header.
//   • RESPONSE_CACHE_ENABLED=0 → fully disabled
//   • Tools / tool_choice present → skip (private payload + risky cross-tool reuse)

const CACHE_ENABLED = process.env.RESPONSE_CACHE_ENABLED !== "0";
const CACHE_TTL_SEC = 3600;

function tenantNamespace(apiKey: string | null | undefined): string {
  // Master / no-auth → shared bucket. Per-key clients → isolated bucket so
  // one tenant's cached response can't be served to another.
  if (!apiKey) return "_anon";
  // Use the prefix for sml_live_ keys (avoid hashing the full secret) and a
  // short hash for everything else.
  if (apiKey.startsWith("sml_live_")) return apiKey.slice(0, 18);
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 12);
}

function cacheKey(body: Record<string, unknown>, apiKey: string | null): string {
  const messages = body.messages;
  const model = body.model ?? "auto";
  const temperature = body.temperature ?? 0;
  const payload = JSON.stringify({ model, messages, temperature });
  const hash = createHash("sha256").update(payload).digest("hex").slice(0, 32);
  return `respcache:${tenantNamespace(apiKey)}:${hash}`;
}

function shouldSkip(body: Record<string, unknown>, optOut: boolean): boolean {
  if (!CACHE_ENABLED) return true;
  if (optOut) return true;
  if (body.stream === true) return true;
  // Tools/tool_choice carry private function definitions and the response
  // shape varies wildly per call — never reuse across requests.
  if (body.tools || body.tool_choice) return true;
  return false;
}

export async function getCachedResponse(
  body: Record<string, unknown>,
  apiKey: string | null = null,
  optOut = false,
): Promise<{ content: string; provider: string; model: string } | null> {
  if (shouldSkip(body, optOut)) return null;
  try {
    const redis = getRedis();
    const raw = await redis.get(cacheKey(body, apiKey));
    if (!raw) return null;
    return JSON.parse(raw) as { content: string; provider: string; model: string };
  } catch {
    return null;
  }
}

export async function setCachedResponse(
  body: Record<string, unknown>,
  response: { content: string; provider: string; model: string },
  apiKey: string | null = null,
  optOut = false,
): Promise<void> {
  if (shouldSkip(body, optOut)) return;
  try {
    const redis = getRedis();
    await redis.set(cacheKey(body, apiKey), JSON.stringify(response), "EX", CACHE_TTL_SEC);
  } catch {
    // silent — cache is optional
  }
}
