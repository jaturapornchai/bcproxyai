/**
 * Provider Resolver — DB-first lookup ของ provider URL + env var
 *
 * Cache catalog ใน memory ทุก 30s → sync API (เร็ว, ไม่ block request path)
 * Priority:
 *   1. provider_catalog (DB)  — รวม discovered providers
 *   2. PROVIDER_URLS (hardcoded fallback) — backwards compat
 *
 * เป้าหมาย: discovered provider = ใช้งานได้ทันที โดยไม่ต้องแก้ code
 */
import { getSqlClient } from "@/lib/db/schema";
import { PROVIDER_URLS as HARDCODED_URLS, PROVIDER_LABELS as HARDCODED_LABELS } from "@/lib/providers";

interface CatalogEntry {
  name: string;
  base_url: string;
  env_var: string | null;
  label: string | null;
  status: string;
  source: string;
}

let cache: Map<string, CatalogEntry> = new Map();
let cacheTime = 0;
let refreshInProgress = false;
const CACHE_TTL_MS = 30_000;

// Hardcoded ENV_MAP — fallback (must match api-keys.ts)
const HARDCODED_ENV_MAP: Record<string, string> = {
  thaillm: "THAILLM_API_KEY",
  typhoon: "TYPHOON_API_KEY",
  chinda: "CHINDA_API_KEY",
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
      SELECT name, base_url, env_var, label, status, source
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
 * Resolve provider chat completions URL.
 * Priority: DB catalog > hardcoded PROVIDER_URLS > "" (caller treats as unknown)
 */
export function resolveProviderUrl(provider: string): string {
  maybeRefresh();
  const fromDb = cache.get(provider)?.base_url;
  if (fromDb) return fromDb;
  return HARDCODED_URLS[provider] ?? "";
}

/**
 * Resolve env var name for the provider's API key.
 * Priority: DB catalog > hardcoded ENV_MAP > guessed (UPPER_SNAKE_API_KEY)
 */
export function resolveProviderEnvVar(provider: string): string {
  maybeRefresh();
  const fromDb = cache.get(provider)?.env_var;
  if (fromDb) return fromDb;
  return HARDCODED_ENV_MAP[provider] ?? `${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
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
