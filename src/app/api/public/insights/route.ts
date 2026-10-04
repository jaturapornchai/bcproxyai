import { NextResponse } from "next/server";
import { buildInsights } from "@/lib/insights";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

// Anonymous control-center aggregates for visitors — no auth, no provider/model names (see src/lib/insights.ts).
export async function GET() {
  try {
    return NextResponse.json(await buildInsights("public"), { headers: noStore });
  } catch (err) {
    console.error("[public/insights] error:", err);
    return NextResponse.json({ error: { message: "insights unavailable", type: "server_error" } }, { status: 503, headers: noStore });
  }
}
