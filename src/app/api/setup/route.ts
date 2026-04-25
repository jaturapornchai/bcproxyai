import { NextRequest, NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";
import { setProviderEnabled, getAllProviderToggles } from "@/lib/provider-toggle";
import { triggerExamForProvider } from "@/lib/worker/exam";
import { runWorkerCycle } from "@/lib/worker";
import { seal as sealSecret, open as openSecret } from "@/lib/secret-vault";

export const dynamic = "force-dynamic";

// Validity is derived from provider_catalog (no hardcoded allowlist).
async function isValidProvider(provider: string): Promise<boolean> {
  if (!provider || typeof provider !== "string") return false;
  try {
    const sql = getSqlClient();
    const rows = await sql<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM provider_catalog WHERE name = ${provider}
    `;
    return Number(rows[0]?.count ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function GET() {
  try {
    const sql = getSqlClient();
    const rows = await sql<{ provider: string; api_key: string; updated_at: Date }[]>`
      SELECT provider, api_key, updated_at FROM api_keys
    `;

    const result = rows.map((r) => {
      const plaintext = openSecret(r.api_key);
      return {
        provider: r.provider,
        hasDbKey: plaintext.length > 0,
        maskedKey: maskKey(plaintext),
        updatedAt: r.updated_at,
      };
    });

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

    if (!(await isValidProvider(provider))) {
      return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
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

    // sealSecret is a no-op when APP_ENCRYPTION_KEY is unset — we still
    // store plaintext in dev. Once the operator sets the env, every save
    // writes ciphertext while existing plaintext rows continue to work.
    const stored = sealSecret(apiKey.trim());
    await sql`
      INSERT INTO api_keys (provider, api_key, updated_at)
      VALUES (${provider}, ${stored}, now())
      ON CONFLICT (provider) DO UPDATE SET api_key = EXCLUDED.api_key, updated_at = now()
    `;

    // ใส่ key ใหม่ → ให้ model ที่เคยตก/รอ schedule ของ provider นี้ค่อยสอบใหม่ทันที
    // (กันสอบวน: เฉพาะ attempt ที่เก่ากว่า 5 นาที + worker cycle ตรวจซ้ำอีกชั้น)
    const { scheduled } = await triggerExamForProvider(provider);

    // Trigger worker cycle (fire-and-forget) — scan + exam ใหม่
    runWorkerCycle().catch((err) => {
      console.error("[setup] worker trigger error:", err);
    });

    return NextResponse.json({ ok: true, action: "saved", retriggeredExams: scheduled });
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
