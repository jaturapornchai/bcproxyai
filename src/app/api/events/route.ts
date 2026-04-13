import { NextRequest, NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sql = getSqlClient();
    const since = req.nextUrl.searchParams.get("since");

    let events;
    if (since) {
      events = await sql`
        SELECT * FROM events
        WHERE created_at > ${since}::timestamptz
        ORDER BY created_at DESC
        LIMIT 50
      `;
    } else {
      events = await sql`
        SELECT * FROM events
        WHERE created_at >= now() - interval '1 hour'
        ORDER BY created_at DESC
        LIMIT 50
      `;
    }

    return NextResponse.json({ events });
  } catch (err) {
    console.error("[events] error:", err);
    return NextResponse.json({ events: [] }, { status: 500 });
  }
}
