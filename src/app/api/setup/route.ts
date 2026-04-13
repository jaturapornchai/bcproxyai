import { NextRequest, NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";
import { setProviderEnabled, getAllProviderToggles } from "@/lib/provider-toggle";

export const dynamic = "force-dynamic";

const VALID_PROVIDERS = new Set([
  "openrouter", "kilo", "google", "groq", "cerebras", "sambanova",
  "mistral", "ollama", "github", "fireworks", "cohere", "cloudflare", "huggingface", "nvidia",
  "chutes", "llm7", "scaleway", "pollinations", "ollamacloud", "siliconflow", "glhf",
  "together", "hyperbolic", "zai", "dashscope", "reka",
]);

export async function GET() {
  try {
    const sql = getSqlClient();
    const rows = await sql<{ provider: string; api_key: string; updated_at: Date }[]>`
      SELECT provider, api_key, updated_at FROM api_keys
    `;

    const result = rows.map((r) => ({
      provider: r.provider,
      hasDbKey: r.api_key.length > 0,
      maskedKey: maskKey(r.api_key),
      updatedAt: r.updated_at,
    }));

    return NextResponse.json(result);
  } catch (err) {
    console.error("[setup] GET error:", err);
    return NextResponse.json([], { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { provider, apiKey, enabled } = body as { provider: string; apiKey?: string; enabled?: boolean };

    if (!provider || !VALID_PROVIDERS.has(provider)) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }

    // Toggle เปิด/ปิด provider (ไม่ต้องส่ง apiKey)
    if (typeof enabled === "boolean") {
      await setProviderEnabled(provider, enabled);
      return NextResponse.json({ ok: true, action: enabled ? "enabled" : "disabled" });
    }

    const sql = getSqlClient();

    if (!apiKey || apiKey.trim() === "") {
      await sql`DELETE FROM api_keys WHERE provider = ${provider}`;
      return NextResponse.json({ ok: true, action: "deleted" });
    }

    await sql`
      INSERT INTO api_keys (provider, api_key, updated_at)
      VALUES (${provider}, ${apiKey.trim()}, now())
      ON CONFLICT (provider) DO UPDATE SET api_key = EXCLUDED.api_key, updated_at = now()
    `;

    return NextResponse.json({ ok: true, action: "saved" });
  } catch (err) {
    console.error("[setup] POST error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// คืน toggle map สำหรับ UI
export async function PATCH() {
  try {
    const toggles = await getAllProviderToggles();
    return NextResponse.json({ toggles });
  } catch {
    return NextResponse.json({ toggles: {} });
  }
}

function maskKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 4) + "••••••••" + key.slice(-4);
}
