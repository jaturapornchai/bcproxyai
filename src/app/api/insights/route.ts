import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildInsights } from "@/lib/insights";
import { isOwnerRequest } from "@/lib/owner-request";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

// Owner control-center aggregates (provider/model names, incidents, limits). The proxy already gates /api/*; checked again here.
export async function GET(req: NextRequest) {
  if (!(await isOwnerRequest(req))) {
    return NextResponse.json({ error: { message: "owner only", type: "auth_error" } }, { status: 401, headers: noStore });
  }
  try {
    return NextResponse.json(await buildInsights("owner"), { headers: noStore });
  } catch (err) {
    console.error("[insights] error:", err);
    return NextResponse.json({ error: { message: "insights unavailable", type: "server_error" } }, { status: 503, headers: noStore });
  }
}
