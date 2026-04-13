import { NextResponse } from "next/server";
import { getAllLimits } from "@/lib/provider-limits";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const limits = await getAllLimits();
    return NextResponse.json({ limits });
  } catch (err) {
    return NextResponse.json({ limits: [], error: String(err) }, { status: 500 });
  }
}
