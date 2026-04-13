import { NextResponse } from "next/server";
import { getLearningSummary } from "@/lib/learning";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const summary = await getLearningSummary();
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
