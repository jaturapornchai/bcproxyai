import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PROVIDER_MODELS: Record<string, { url: string; auth: "bearer" | "query-key" | "none" }> = {
  openrouter: { url: "https://openrouter.ai/api/v1/models", auth: "bearer" },
  kilo: { url: "https://api.kilo.ai/api/gateway/models", auth: "bearer" },
  google: { url: "https://generativelanguage.googleapis.com/v1beta/models", auth: "query-key" },
  groq: { url: "https://api.groq.com/openai/v1/models", auth: "bearer" },
  cerebras: { url: "https://api.cerebras.ai/v1/models", auth: "bearer" },
  sambanova: { url: "https://api.sambanova.ai/v1/models", auth: "bearer" },
  mistral: { url: "https://api.mistral.ai/v1/models", auth: "bearer" },
  ollama: { url: `${process.env.OLLAMA_BASE_URL || "http://localhost:11434"}/v1/models`, auth: "none" },
  github: { url: "https://models.github.ai/inference/models", auth: "bearer" },
  fireworks: { url: "https://api.fireworks.ai/inference/v1/models", auth: "bearer" },
  cohere: { url: "https://api.cohere.com/v2/models", auth: "bearer" },
  cloudflare: { url: `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID || "unknown"}/ai/models/search?task=Text+Generation`, auth: "bearer" },
  huggingface: { url: "https://huggingface.co/api/models?pipeline_tag=text-generation&sort=trending&limit=5", auth: "bearer" },
  nvidia: { url: "https://integrate.api.nvidia.com/v1/models", auth: "bearer" },
  chutes: { url: "https://llm.chutes.ai/v1/models", auth: "bearer" },
  llm7: { url: "https://api.llm7.io/v1/models", auth: "bearer" },
  scaleway: { url: "https://api.scaleway.ai/v1/models", auth: "bearer" },
  pollinations: { url: "https://text.pollinations.ai/models", auth: "none" },
  ollamacloud: { url: "https://ollama.com/v1/models", auth: "bearer" },
  siliconflow: { url: "https://api.siliconflow.cn/v1/models", auth: "bearer" },
  glhf: { url: "https://glhf.chat/api/openai/v1/models", auth: "bearer" },
  together: { url: "https://api.together.xyz/v1/models", auth: "bearer" },
  hyperbolic: { url: "https://api.hyperbolic.xyz/v1/models", auth: "bearer" },
  zai: { url: "https://api.z.ai/api/paas/v4/chat/completions", auth: "bearer" },
  dashscope: { url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models", auth: "bearer" },
  reka: { url: "https://api.reka.ai/v1/models", auth: "bearer" },
};

export async function POST(req: NextRequest) {
  const { provider, apiKey } = await req.json();

  const config = PROVIDER_MODELS[provider];
  if (!config) {
    return NextResponse.json({ ok: false, error: "Unknown provider" }, { status: 400 });
  }

  let url = config.url;
  if (config.auth === "query-key") url += `?key=${apiKey}`;

  const headers: Record<string, string> = {};
  if (config.auth === "bearer") headers["Authorization"] = `Bearer ${apiKey}`;

  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json({
        ok: false,
        error: `HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      });
    }

    const json = await res.json();
    const models =
      json.data?.length ?? json.models?.length ?? json.result?.length ?? 0;

    return NextResponse.json({ ok: true, models });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err).slice(0, 200) });
  }
}
