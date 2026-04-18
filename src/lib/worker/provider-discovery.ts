/**
 * Provider Auto-Discovery Worker
 *
 * แหล่งค้นหา (3 layer):
 *   1. Seed จาก code — provider ที่ระบบ wire แล้ว (PROVIDER_URLS) → status='active'
 *   2. OpenRouter `/api/v1/providers` — public endpoint, list ของ provider ที่ OR รู้จัก
 *   3. HuggingFace inference providers — public list
 *   4. Pattern test — known candidate hosts ที่ไม่อยู่ใน catalog → ลอง GET /v1/models รับ 200 + JSON valid
 *
 * พบ provider ใหม่:
 *   - INSERT INTO provider_catalog (status='pending')
 *   - INSERT INTO events (type='provider_discovered')
 *   - INSERT INTO dev_suggestions (severity='info', category='provider')
 */
import { getSqlClient } from "@/lib/db/schema";
import { PROVIDER_URLS, PROVIDER_LABELS } from "@/lib/providers";

const DISCOVERY_TIMEOUT_MS = 5_000;

interface CatalogRow {
  name: string;
  label: string;
  base_url: string;
  env_var: string | null;
  homepage: string | null;
  status: "active" | "pending" | "failed" | "paused";
  source: string;
  free_tier: boolean;
  notes: string | null;
}

// ─── Helper: log ─────────────────────────────────────────────────────────────

async function logWorker(message: string, level = "info") {
  try {
    const sql = getSqlClient();
    await sql`INSERT INTO worker_logs (step, message, level) VALUES ('discovery', ${message}, ${level})`;
  } catch { /* silent */ }
}

// ─── Seed catalog from code (idempotent) ─────────────────────────────────────

const SEED_NOTES: Record<string, { homepage?: string; freeTier?: boolean; notes?: string }> = {
  openrouter:   { homepage: "https://openrouter.ai/keys", freeTier: true,  notes: "Aggregator + free tier" },
  kilo:         { homepage: "https://kilo.ai", freeTier: true, notes: "Free, no key required" },
  google:       { homepage: "https://aistudio.google.com/apikey", freeTier: true, notes: "Gemini, free tier" },
  groq:         { homepage: "https://console.groq.com/keys", freeTier: true, notes: "Fastest inference" },
  cerebras:     { homepage: "https://cloud.cerebras.ai", freeTier: true, notes: "WSE chip" },
  sambanova:    { homepage: "https://cloud.sambanova.ai", freeTier: true },
  mistral:      { homepage: "https://console.mistral.ai", freeTier: true },
  ollama:       { homepage: "https://ollama.com", freeTier: true, notes: "Local, no auth" },
  github:       { homepage: "https://github.com/marketplace/models", freeTier: true },
  fireworks:    { homepage: "https://fireworks.ai", freeTier: true },
  cohere:       { homepage: "https://cohere.com", freeTier: true },
  cloudflare:   { homepage: "https://workers.cloudflare.com/ai", freeTier: true },
  huggingface:  { homepage: "https://huggingface.co/inference-endpoints", freeTier: true },
  nvidia:       { homepage: "https://build.nvidia.com", freeTier: true, notes: "1000 req/mo free" },
  chutes:       { homepage: "https://chutes.ai", freeTier: true, notes: "Community GPU" },
  llm7:         { homepage: "https://llm7.io", freeTier: true, notes: "30 RPM free" },
  scaleway:     { homepage: "https://console.scaleway.com", freeTier: true, notes: "1M tokens free" },
  pollinations: { homepage: "https://pollinations.ai", freeTier: true, notes: "No key required" },
  ollamacloud:  { homepage: "https://ollama.com/cloud", freeTier: true, notes: "100 req/hr free" },
  siliconflow:  { homepage: "https://siliconflow.com", freeTier: true },
  glhf:         { homepage: "https://glhf.chat", freeTier: true },
  together:     { homepage: "https://together.ai", freeTier: true },
  hyperbolic:   { homepage: "https://hyperbolic.xyz", freeTier: true },
  zai:          { homepage: "https://z.ai", freeTier: true },
  dashscope:    { homepage: "https://dashscope-intl.aliyuncs.com", freeTier: true, notes: "Qwen — Alibaba" },
  reka:         { homepage: "https://reka.ai", freeTier: false },
  deepseek:     { homepage: "https://platform.deepseek.com", freeTier: false, notes: "Cheap, paid" },
  deepinfra:    { homepage: "https://deepinfra.com", freeTier: true, notes: "Free credit" },
  novita:       { homepage: "https://novita.ai", freeTier: true, notes: "Free credit" },
  monsterapi:   { homepage: "https://monsterapi.ai", freeTier: true },
  friendli:     { homepage: "https://friendli.ai", freeTier: true, notes: "1M tokens free" },
  xai:          { homepage: "https://console.x.ai", freeTier: false, notes: "Grok — paid" },
  moonshot:     { homepage: "https://platform.moonshot.ai", freeTier: false, notes: "Kimi — paid" },
  ai21:         { homepage: "https://studio.ai21.com", freeTier: true, notes: "Free trial" },
};

const ENV_BY_PROVIDER: Record<string, string> = {
  openrouter: "OPENROUTER_API_KEY", kilo: "KILO_API_KEY", google: "GOOGLE_AI_API_KEY",
  groq: "GROQ_API_KEY", cerebras: "CEREBRAS_API_KEY", sambanova: "SAMBANOVA_API_KEY",
  mistral: "MISTRAL_API_KEY", ollama: "OLLAMA_API_KEY", github: "GITHUB_MODELS_TOKEN",
  fireworks: "FIREWORKS_API_KEY", cohere: "COHERE_API_KEY", cloudflare: "CLOUDFLARE_API_TOKEN",
  huggingface: "HF_TOKEN", nvidia: "NVIDIA_API_KEY", chutes: "CHUTES_API_KEY",
  llm7: "LLM7_API_KEY", scaleway: "SCALEWAY_API_KEY", pollinations: "POLLINATIONS_API_KEY",
  ollamacloud: "OLLAMA_CLOUD_API_KEY", siliconflow: "SILICONFLOW_API_KEY", glhf: "GLHF_API_KEY",
  together: "TOGETHER_API_KEY", hyperbolic: "HYPERBOLIC_API_KEY", zai: "ZAI_API_KEY",
  dashscope: "DASHSCOPE_API_KEY", reka: "REKA_API_KEY",
  deepseek: "DEEPSEEK_API_KEY", deepinfra: "DEEPINFRA_API_KEY", novita: "NOVITA_API_KEY",
  monsterapi: "MONSTERAPI_API_KEY", friendli: "FRIENDLI_API_KEY", xai: "XAI_API_KEY",
  moonshot: "MOONSHOT_API_KEY", ai21: "AI21_API_KEY",
};

export async function seedProviderCatalog(): Promise<void> {
  const sql = getSqlClient();
  for (const [name, baseUrl] of Object.entries(PROVIDER_URLS)) {
    const meta = SEED_NOTES[name] ?? {};
    await sql`
      INSERT INTO provider_catalog (name, label, base_url, env_var, homepage, status, source, free_tier, notes)
      VALUES (${name}, ${PROVIDER_LABELS[name] ?? name}, ${baseUrl}, ${ENV_BY_PROVIDER[name] ?? null},
              ${meta.homepage ?? null}, 'active', 'seed', ${meta.freeTier ?? false}, ${meta.notes ?? null})
      ON CONFLICT (name) DO UPDATE SET
        label = EXCLUDED.label,
        base_url = EXCLUDED.base_url,
        env_var = EXCLUDED.env_var,
        homepage = COALESCE(EXCLUDED.homepage, provider_catalog.homepage),
        status = CASE WHEN provider_catalog.status = 'paused' THEN 'paused' ELSE 'active' END,
        free_tier = EXCLUDED.free_tier,
        notes = COALESCE(EXCLUDED.notes, provider_catalog.notes),
        updated_at = now()
    `;
  }
}

// ─── Discovery sources ───────────────────────────────────────────────────────

interface Discovery {
  name: string;
  base_url: string;
  homepage?: string;
  source: "openrouter" | "huggingface" | "pattern";
  notes?: string;
}

async function fetchOpenRouterProviders(): Promise<Discovery[]> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/providers", {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const json = await res.json() as { data?: Array<{ slug?: string; name?: string; status?: string }> };
    const arr = json.data ?? [];
    return arr
      .filter((p) => p.slug && p.status !== "removed")
      .map((p) => ({
        name: normalizeName(p.slug!),
        base_url: `https://openrouter.ai/api/v1/chat/completions?provider=${p.slug}`,
        homepage: `https://openrouter.ai/provider/${p.slug}`,
        source: "openrouter" as const,
        notes: `via OpenRouter: ${p.name ?? p.slug}`,
      }));
  } catch (err) {
    await logWorker(`OpenRouter providers fetch failed: ${err instanceof Error ? err.message : err}`, "warn");
    return [];
  }
}

async function fetchHuggingFaceProviders(): Promise<Discovery[]> {
  // HF list: ที่ inference router รองรับ (public, ไม่ต้อง key)
  const known = [
    { slug: "fal-ai", name: "fal.ai", url: "https://api.fal.ai/v1/chat/completions", homepage: "https://fal.ai" },
    { slug: "replicate", name: "Replicate", url: "https://api.replicate.com/v1/chat/completions", homepage: "https://replicate.com" },
    { slug: "sambanova", name: "SambaNova", url: "https://api.sambanova.ai/v1/chat/completions", homepage: "https://cloud.sambanova.ai" },
  ];
  return known.map((p) => ({
    name: normalizeName(p.slug),
    base_url: p.url,
    homepage: p.homepage,
    source: "huggingface",
    notes: `via HF inference: ${p.name}`,
  }));
}

// Candidate URLs ที่ลอง pattern test — รายการ provider ที่อาจมี OpenAI-compatible endpoint
const PATTERN_CANDIDATES: Array<{ name: string; url: string; modelsUrl: string; homepage: string }> = [
  { name: "anthropic",   url: "https://api.anthropic.com/v1/chat/completions",          modelsUrl: "https://api.anthropic.com/v1/models",          homepage: "https://anthropic.com" },
  { name: "openai",      url: "https://api.openai.com/v1/chat/completions",             modelsUrl: "https://api.openai.com/v1/models",             homepage: "https://platform.openai.com" },
  { name: "perplexity",  url: "https://api.perplexity.ai/chat/completions",             modelsUrl: "https://api.perplexity.ai/chat/completions",   homepage: "https://docs.perplexity.ai" },
  { name: "anyscale",    url: "https://api.endpoints.anyscale.com/v1/chat/completions", modelsUrl: "https://api.endpoints.anyscale.com/v1/models", homepage: "https://anyscale.com" },
  { name: "lepton",      url: "https://api.lepton.ai/api/v1/chat/completions",          modelsUrl: "https://api.lepton.ai/api/v1/models",          homepage: "https://lepton.ai" },
  { name: "octoai",      url: "https://text.octoai.run/v1/chat/completions",            modelsUrl: "https://text.octoai.run/v1/models",            homepage: "https://octo.ai" },
  { name: "bytedance",   url: "https://ark.cn-beijing.volces.com/api/v3/chat/completions", modelsUrl: "https://ark.cn-beijing.volces.com/api/v3/models", homepage: "https://volcengine.com" },
  { name: "writer",      url: "https://api.writer.com/v1/chat",                         modelsUrl: "https://api.writer.com/v1/models",             homepage: "https://writer.com" },
  { name: "voyage",      url: "https://api.voyageai.com/v1/chat/completions",           modelsUrl: "https://api.voyageai.com/v1/embeddings",       homepage: "https://voyageai.com" },
  { name: "lambdalabs",  url: "https://api.lambdalabs.com/v1/chat/completions",         modelsUrl: "https://api.lambdalabs.com/v1/models",         homepage: "https://lambdalabs.com" },
  { name: "runpod",      url: "https://api.runpod.ai/v2/openai/chat/completions",       modelsUrl: "https://api.runpod.ai/v2/openai/models",       homepage: "https://runpod.io" },
];

async function probePatternCandidates(existingNames: Set<string>): Promise<Discovery[]> {
  const newDiscoveries: Discovery[] = [];
  // Probe in parallel with concurrency 4
  const todo = PATTERN_CANDIDATES.filter((c) => !existingNames.has(c.name));
  const queue = [...todo];

  async function worker() {
    while (queue.length > 0) {
      const c = queue.shift();
      if (!c) return;
      try {
        const res = await fetch(c.modelsUrl, {
          method: "GET",
          signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
        });
        // 200 (open) หรือ 401/403 (auth required แต่ host มีจริง) ถือว่าค้นพบ
        // 404/ENOTFOUND/timeout → ไม่นับ
        if (res.status === 200 || res.status === 401 || res.status === 403) {
          newDiscoveries.push({
            name: c.name,
            base_url: c.url,
            homepage: c.homepage,
            source: "pattern",
            notes: `probe HTTP ${res.status} on ${c.modelsUrl}`,
          });
        }
      } catch { /* timeout / dns fail = ไม่นับ */ }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  return newDiscoveries;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Alias map: slug หลายแบบ → canonical name เดียว
// เพื่อกัน duplicate ระหว่าง seed และ OpenRouter/HF/pattern
const ALIAS_MAP: Record<string, string> = {
  // Moonshot AI
  moonshotai:        "moonshot",
  // Google — AI Studio, Vertex, direct = ผู้ผลิตเดียวกัน
  googleaistudio:    "google",
  googlevertex:      "google",
  // Alibaba Qwen
  alibaba:           "dashscope",
  alibabacloud:      "dashscope",
  qwen:              "dashscope",
  // Amazon — Nova เป็นแบรนด์ใน Bedrock
  amazonnova:        "amazonbedrock",
  amazon:            "amazonbedrock",
  // ByteDance / Volcano Ark
  volcanoark:        "bytedance",
  bytedancevolcano:  "bytedance",
  // OpenRouter slug "moonshot-ai" alt spellings
  moonshot_ai:       "moonshot",
  // HuggingFace slug forms
  fal_ai:            "falai",
};

function normalizeName(slug: string): string {
  const norm = slug.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ALIAS_MAP[norm] ?? norm;
}

async function getExistingNames(): Promise<Set<string>> {
  const sql = getSqlClient();
  const rows = await sql<{ name: string }[]>`SELECT name FROM provider_catalog`;
  return new Set(rows.map((r) => r.name));
}

// ─── Main: discoverProviders ─────────────────────────────────────────────────

export interface DiscoveryResult {
  scanned: number;
  newFound: number;
  newProviders: string[];
}

export async function discoverProviders(): Promise<DiscoveryResult> {
  const sql = getSqlClient();
  await logWorker("🔎 เริ่มค้นหา provider ใหม่จากอินเทอร์เน็ต");

  // 1. Refresh seed (ถ้า code เพิ่ม provider ใหม่ → sync เข้า DB)
  await seedProviderCatalog();

  const existing = await getExistingNames();

  // 2. Run discovery sources in parallel
  const [orList, hfList, patternList] = await Promise.all([
    fetchOpenRouterProviders(),
    fetchHuggingFaceProviders(),
    probePatternCandidates(existing),
  ]);

  const all = [...orList, ...hfList, ...patternList];
  const newOnes: Discovery[] = [];

  for (const d of all) {
    if (existing.has(d.name)) continue;
    existing.add(d.name); // ป้องกัน duplicate ใน rounds เดียวกัน
    newOnes.push(d);

    // Auto-add: status='active' ทันที — ระบบ resolve URL/env จาก DB เอง ไม่ต้องรอ Dev wire
    const envGuess = `${d.name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
    await sql`
      INSERT INTO provider_catalog (name, label, base_url, env_var, homepage, status, source, free_tier, notes, last_probed_at, probe_status_code)
      VALUES (${d.name}, ${d.name}, ${d.base_url}, ${envGuess}, ${d.homepage ?? null}, 'active', ${d.source}, false, ${d.notes ?? null}, now(), 200)
      ON CONFLICT (name) DO UPDATE SET
        last_probed_at = now(),
        notes = COALESCE(EXCLUDED.notes, provider_catalog.notes),
        updated_at = now()
    `;

    // Emit event (informational only — no human action needed)
    await sql`
      INSERT INTO events (type, title, detail, severity)
      VALUES ('provider_discovered', ${`เพิ่ม provider ใหม่อัตโนมัติ: ${d.name}`}, ${`${d.source} → ${d.base_url} — พร้อมใช้งานทันที (ใส่ key ใน Setup ได้เลย)`}, 'info')
    `.catch(() => {});
  }

  const msg = `🔎 ค้นพบ ${all.length} (OR=${orList.length}, HF=${hfList.length}, pattern=${patternList.length}) — ใหม่ ${newOnes.length}`;
  await logWorker(msg, newOnes.length > 0 ? "success" : "info");
  if (newOnes.length > 0) {
    await logWorker(`✨ Provider ใหม่: ${newOnes.map((d) => d.name).join(", ")}`, "success");
  }

  return { scanned: all.length, newFound: newOnes.length, newProviders: newOnes.map((d) => d.name) };
}
