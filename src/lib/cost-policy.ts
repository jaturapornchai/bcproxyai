import {
  getHardcodedFreeModelRules,
  getHardcodedFreeProviders,
  isHardcodedFreeModel,
} from "@/lib/free-model-catalog";

/**
 * Cost guard for every upstream call. This deployment intentionally ignores
 * runtime allowlist env vars and allows only the hardcoded zero-price remote
 * model catalog. Local Ollama and provider-wide free lists are blocked.
 */
export function getFreeProviderAllowlist(): Set<string> {
  return new Set();
}

export function getFreeModelAllowlist(): string[] {
  return getHardcodedFreeModelRules();
}

export function isPaidProviderOverrideEnabled(): boolean {
  return false;
}

export function isProviderCostAllowed(provider: string): boolean {
  const normalized = provider.toLowerCase();
  return getHardcodedFreeProviders().includes(normalized);
}

export function isModelCostAllowed(provider: string, modelId: string | null | undefined): boolean {
  return isHardcodedFreeModel(provider.toLowerCase(), modelId);
}

export function getCostAllowedProviders(): string[] {
  return getHardcodedFreeProviders();
}

export function costPolicyBlockMessage(provider: string, modelId?: string | null): string {
  const target = modelId ? `${provider}/${modelId}` : provider;
  return `Provider/model '${target}' is blocked by cost policy. This gateway allows only hardcoded remote free models (${getFreeModelAllowlist().join(", ")}). Local models, provider-wide allowlists, router aliases, and paid overrides are disabled.`;
}

// Body keys that let an upstream reach paid models/features even when `model` is free:
// OpenRouter fallback lists (models), routing presets, provider preferences, web search / plugins.
const PAID_BODY_KEYS = ["models", "route", "preset", "provider", "plugins", "web_search_options", "web_search", "search"] as const;

/** OpenRouter refuses to run a request priced above this (docs: provider.max_price) — a server-side $0 ceiling. */
export const OPENROUTER_ZERO_PRICE = { prompt: 0, completion: 0, request: 0, image: 0 } as const;

// Billed outside max_price even on free models: server-side tools (openrouter:web_search/advisor/
// image_generation/..., Groq browser_search/code_interpreter) and file/document parts (PDF OCR engines).
// Only client-executed `function` tools and text/image content parts may reach an upstream.
const FREE_CONTENT_PART_TYPES = new Set(["text", "image_url"]);
const typeOf = (value: unknown): unknown => (value as { type?: unknown } | null)?.type;

/** Same array back when nothing is dropped, so rejectPaidBodyKeys can detect changes by reference. */
function keepFreeContentParts(messages: unknown[]): unknown[] {
  let changed = false;
  const next = messages.map((message) => {
    const content = (message as { content?: unknown } | null)?.content;
    if (!Array.isArray(content)) return message;
    const kept = content.filter((part) => FREE_CONTENT_PART_TYPES.has(String(typeOf(part))));
    if (kept.length === content.length) return message;
    changed = true;
    return { ...(message as object), content: kept };
  });
  return changed ? next : messages;
}

/**
 * Last line of defense right before ANY upstream call: strip keys that can widen past `model`,
 * server tools and file parts, and for OpenRouter pin max_price to 0 so OpenRouter itself rejects
 * anything billable. Untouched keys keep their original reference.
 */
export function applyNoSpendGuards(provider: string, body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };
  for (const key of PAID_BODY_KEYS) delete out[key];
  if (Array.isArray(body.tools)) {
    const tools = body.tools.filter((tool) => typeOf(tool) === "function");
    if (tools.length === 0 && body.tools.length > 0) {
      delete out.tools;
      delete out.tool_choice;
    } else if (tools.length !== body.tools.length) {
      out.tools = tools;
    }
  }
  const choiceType = typeOf(out.tool_choice);
  if (choiceType !== undefined && choiceType !== "function") delete out.tool_choice;
  if (Array.isArray(out.messages)) out.messages = keepFreeContentParts(out.messages);
  if (provider.toLowerCase() === "openrouter") out.provider = { max_price: { ...OPENROUTER_ZERO_PRICE } };
  return out;
}
