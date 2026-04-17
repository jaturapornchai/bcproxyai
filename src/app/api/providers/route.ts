import { NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";
import { PROVIDER_URLS } from "@/lib/providers";
import { getAllProviderToggles } from "@/lib/provider-toggle";

export const dynamic = "force-dynamic";

const ENV_MAP: Record<string, string> = {
  openrouter: "OPENROUTER_API_KEY",
  kilo: "KILO_API_KEY",
  google: "GOOGLE_AI_API_KEY",
  groq: "GROQ_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  sambanova: "SAMBANOVA_API_KEY",
  mistral: "MISTRAL_API_KEY",
  ollama: "OLLAMA_API_KEY",
  github: "GITHUB_MODELS_TOKEN",
  fireworks: "FIREWORKS_API_KEY",
  cohere: "COHERE_API_KEY",
  cloudflare: "CLOUDFLARE_API_TOKEN",
  huggingface: "HF_TOKEN",
  nvidia: "NVIDIA_API_KEY",
  chutes: "CHUTES_API_KEY",
  llm7: "LLM7_API_KEY",
  scaleway: "SCALEWAY_API_KEY",
  pollinations: "POLLINATIONS_API_KEY",
  ollamacloud: "OLLAMA_CLOUD_API_KEY",
  siliconflow: "SILICONFLOW_API_KEY",
  glhf: "GLHF_API_KEY",
  together: "TOGETHER_API_KEY",
  hyperbolic: "HYPERBOLIC_API_KEY",
  zai: "ZAI_API_KEY",
  dashscope: "DASHSCOPE_API_KEY",
  reka: "REKA_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  deepinfra: "DEEPINFRA_API_KEY",
  novita: "NOVITA_API_KEY",
  monsterapi: "MONSTERAPI_API_KEY",
  friendli: "FRIENDLI_API_KEY",
  xai: "XAI_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  ai21: "AI21_API_KEY",
};

const NO_KEY_REQUIRED = new Set(["ollama", "pollinations"]);

export async function GET() {
  try {
    const sql = getSqlClient();

    const rows = await sql<{ provider: string; model_count: number; available_count: number }[]>`
      SELECT m.provider, COUNT(*) as model_count,
        SUM(CASE WHEN m.id NOT IN (
          SELECT h.model_id FROM health_logs h
          INNER JOIN (SELECT model_id, MAX(id) as max_id FROM health_logs GROUP BY model_id) l
            ON h.model_id = l.model_id AND h.id = l.max_id
          WHERE h.cooldown_until > now()
        ) THEN 1 ELSE 0 END) as available_count
      FROM models m
      GROUP BY m.provider
    `;

    const dbMap = new Map(rows.map(r => [r.provider, r]));

    // Get DB-stored keys
    const dbKeys = new Map<string, string>();
    try {
      const keyRows = await sql<{ provider: string; api_key: string }[]>`
        SELECT provider, api_key FROM api_keys
      `;
      for (const r of keyRows) dbKeys.set(r.provider, r.api_key);
    } catch { /* table may not exist yet */ }

    const toggleMap = await getAllProviderToggles();
    const ALL_PROVIDERS = Object.keys(PROVIDER_URLS);
    const providers = ALL_PROVIDERS.map(provider => {
      const envVar = ENV_MAP[provider] ?? "";
      const raw = process.env[envVar] ?? "";
      const envKeys = raw.split(",").map(k => k.trim()).filter(Boolean);
      const dbKey = dbKeys.get(provider) ?? "";
      const noKeyRequired = NO_KEY_REQUIRED.has(provider);

      const hasEnvKey = envKeys.length > 0;
      const hasDbKey = dbKey.length > 0;
      const hasKey = noKeyRequired || hasEnvKey || hasDbKey;

      const isPlaceholder = hasEnvKey && !hasDbKey && envKeys.every(k =>
        /^(your_|placeholder|xxx|test|dummy)/i.test(k)
      );

      const dbRow = dbMap.get(provider);
      const modelCount = Number(dbRow?.model_count ?? 0);
      const availableCount = Number(dbRow?.available_count ?? 0);

      const enabled = toggleMap[provider] ?? true;

      let status: "active" | "no_key" | "no_models" | "error" | "disabled";
      if (!enabled) {
        status = "disabled";
      } else if (!hasKey || isPlaceholder) {
        status = "no_key";
      } else if (modelCount === 0) {
        status = "no_models";
      } else if (availableCount > 0) {
        status = "active";
      } else {
        status = "error";
      }

      return {
        provider,
        envVar,
        hasKey: hasKey && !isPlaceholder,
        hasDbKey,
        noKeyRequired,
        enabled,
        modelCount,
        availableCount,
        status,
      };
    });

    return NextResponse.json(providers);
  } catch (err) {
    console.error("[providers] error:", err);
    return NextResponse.json([], { status: 500 });
  }
}
