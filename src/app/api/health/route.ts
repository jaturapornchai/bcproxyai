import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getHealth } from "@/lib/pulse";
import { isOwnerRequest } from "@/lib/owner-request";

export const dynamic = "force-dynamic";

// Public (Caddy health checks, visitors): only { status }, same HTTP code. Owner: the full report.
export async function GET(req: NextRequest) {
  const { body, httpStatus } = await getHealth();
  const full = await isOwnerRequest(req);
  return NextResponse.json(full ? body : { status: body.status }, { status: httpStatus });
}
