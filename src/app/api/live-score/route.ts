import { NextResponse } from "next/server";
import { getAllScores } from "@/lib/live-score";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getAllScores());
}
