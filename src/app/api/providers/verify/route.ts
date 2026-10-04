import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    { ok: false, error: "Provider verification is disabled; BCAiRouter uses the hardcoded free remote model catalog." },
    { status: 410 },
  );
}
