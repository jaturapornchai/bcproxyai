/**
 * Provider Resolver — hardcoded endpoint lookup for no-spend mode
 *
 * Runtime routing must not follow discovered provider URLs. The gateway uses
 * hardcoded endpoints and the hardcoded free model catalog only.
 */
import { getSqlClient } from "@/lib/db/schema";
import {
  PROVIDER_URLS as HARDCODED_URLS,
  PROVIDER_LABELS as HARDCODED_LABELS,
  PROVIDER_EMBEDDING_URLS as HARDCODED_EMBED_URLS,
  PROVIDER_COMPLETIONS_URLS as HARDCODED_COMPL_URLS,
} from "@/lib/providers";

interface CatalogEntry {
  name: string;
  base_url: string;
  env_var: string | null;
  label: string | null;
  status: string;
  source: string;
  auth_scheme: string | null;
  auth_header_name: string | null;
}

let cache: Map<string, CatalogEntry> = new Map();
let cacheTime = 0;
let refreshInProgress = false;
const CACHE_TTL_MS = 30_000;

// Hardcoded ENV_MAP — fallback (must match api-keys.ts)
const HARDCODED_ENV_MAP: Record<string, string> = {
  thaillm: "THAILLM_API_KEY",
  typhoon: "TYPHOON_API_KEY",
  openrouter: "OPENROUTER_API_KEY", kilo: "KILO_API_KEY", google: "GOOGLE_AI_API_KEY",
  groq: "GROQ_API_KEY", cerebras: "CEREBRAS_API_KEY", sambanova: "SAMBANOVA_API_KEY",
  mistral: "MISTRAL_API_KEY", ollama: "OLLAMA_API_KEY", github: "GITHUB_MODELS_TOKEN",
  fireworks: "FIREWORKS_API_KEY", cohere: "COHERE_API_KEY", cloudflare: "CLOUDFLARE_API_TOKEN",
  huggingface: "HF_TOKEN", nvidia: "NVIDIA_API_KEY", chutes: "CHUTES_API_KEY",
  llm7: "LLM7_API_KEY", scaleway: "SCALEWAY_API_KEY", pollinations: "POLLINATIONS_API_KEY",
  ollamacloud: "OLLAMA_CLOUD_API_KEY", siliconflow: "SILICONFLOW_API_KEY", glhf: "GLHF_API_KEY",
  together: "TOGETHER_API_KEY", hyperbolic: "HYPERBOLIC_API_KEY", zai: "ZAI_API_KEY",
  dashscope: "DASHSCOPE_API_KEY", reka: "REKA_API_KEY",
  deepinfra: "DEEPINFRA_API_KEY", novita: "NOVITA_API_KEY",
  monsterapi: "MONSTERAPI_API_KEY", friendli: "FRIENDLI_API_KEY",
  ai21: "AI21_API_KEY",
};

async function refresh(): Promise<void> {
  if (refreshInProgress) return;
  refreshInProgress = true;
  try {
    const sql = getSqlClient();
    const rows = await sql<CatalogEntry[]>`
      SELECT name, base_url, env_var, label, status, source, auth_scheme, auth_header_name
      FROM provider_catalog
      WHERE status = 'active'
    `;
    const next = new Map<string, CatalogEntry>();
    for (const r of rows) next.set(r.name, r);
    cache = next;
    cacheTime = Date.now();
  } catch {
    // Silent — fallback to hardcoded works
  } finally {
    refreshInProgress = false;
  }
}

function maybeRefresh(): void {
  const now = Date.now();
  if (now - cacheTime > CACHE_TTL_MS) {
    refresh().catch(() => {});
  }
}

/**
 * Resolve provider chat completions URL from hardcoded endpoints only.
 */
export function resolveProviderUrl(provider: string): string {
  return HARDCODED_URLS[provider] ?? "";
}

/**
 * Derive embedding URL from a chat completions URL by replacing the path.
 * Works for OpenAI-compatible providers (Ollama, Mistral, OpenRouter, etc).
 */
function deriveEmbedFromChat(chatUrl: string): string | null {
  if (!chatUrl) return null;
  if (chatUrl.includes("/chat/completions")) return chatUrl.replace("/chat/completions", "/embeddings");
  return null;
}

function deriveCompletionsFromChat(chatUrl: string): string | null {
  if (!chatUrl) return null;
  if (chatUrl.includes("/chat/completions")) return chatUrl.replace("/chat/completions", "/completions");
  return null;
}

/**
 * Resolve provider embeddings URL from hardcoded endpoints only.
 */
export function resolveProviderEmbeddingUrl(provider: string): string {
  return HARDCODED_EMBED_URLS[provider] ?? "";
}

/**
 * Resolve provider legacy completions URL from hardcoded endpoints only.
 */
export function resolveProviderCompletionsUrl(provider: string): string {
  return HARDCODED_COMPL_URLS[provider] ?? "";
}

/**
 * Resolve env var name for the provider's API key.
 */
export function resolveProviderEnvVar(provider: string): string {
  return HARDCODED_ENV_MAP[provider] ?? `${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
}

/**
 * Auth scheme for a provider. Defaults to bearer.
 * Used by forwardToProvider + exam askModel to pick the right header.
 */
export type AuthScheme = "bearer" | "apikey-header" | "query-key" | "none";
export function resolveProviderAuth(provider: string): { scheme: AuthScheme; headerName: string } {
  void provider;
  return { scheme: "bearer", headerName: "Authorization" };
}

/**
 * Get human-friendly label
 */
export function resolveProviderLabel(provider: string): string {
  maybeRefresh();
  const fromDb = cache.get(provider)?.label;
  if (fromDb) return fromDb;
  return HARDCODED_LABELS[provider] ?? provider;
}

/**
 * Get all known provider names (DB ∪ hardcoded)
 */
export function getAllProviderNames(): string[] {
  maybeRefresh();
  const set = new Set<string>(Object.keys(HARDCODED_URLS));
  for (const name of cache.keys()) set.add(name);
  return [...set];
}

/**
 * Force refresh now (used after manual discovery)
 */
export async function forceRefresh(): Promise<void> {
  cacheTime = 0;
  await refresh();
}

// Initial load on module import (best-effort, non-blocking)
refresh().catch(() => {});
