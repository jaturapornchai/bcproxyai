import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildPulse } from "@/lib/pulse";
import { isOwnerRequest } from "@/lib/owner-request";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

// Owner live activity (real provider/model names). The proxy already gates /api/*; checked again here.
export async function GET(req: NextRequest) {
  if (!(await isOwnerRequest(req))) {
    return NextResponse.json({ error: { message: "owner only", type: "auth_error" } }, { status: 401, headers: noStore });
  }
  try {
    const data = await buildPulse("owner", req.nextUrl.searchParams.get("since"));
    return NextResponse.json(data, { headers: noStore });
  } catch (err) {
    console.error("[activity] error:", err);
    return NextResponse.json({ error: { message: "activity unavailable", type: "server_error" } }, { status: 503, headers: noStore });
  }
}
