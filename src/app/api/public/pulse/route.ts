import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildPulse } from "@/lib/pulse";

export const dynamic = "force-dynamic";

// Anonymous live activity for visitors — no auth, no provider/model names (see src/lib/pulse.ts).
export async function GET(req: NextRequest) {
  try {
    const data = await buildPulse("public", req.nextUrl.searchParams.get("since"));
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[public/pulse] error:", err);
    return NextResponse.json(
      { error: { message: "pulse unavailable", type: "server_error" } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
