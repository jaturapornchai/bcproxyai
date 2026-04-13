import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

export const dynamic = "force-dynamic";

// POST /api/k6-report
// k6 scripts call this from their handleSummary() hook to record the last
// run of each script. Summaries are stored in Redis as k6:last:<script>
// with a 7-day TTL so the infra panel can display them.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      script?: string;
      checks?: { passes?: number; fails?: number };
      metrics?: {
        http_reqs?: number;
        http_req_failed_rate?: number;
        p95?: number;
        p99?: number;
        avg?: number;
      };
      duration?: number;
      vus?: number;
    };

    const script = (body.script || "unknown").replace(/[^a-zA-Z0-9_-]/g, "");
    const record = {
      script,
      at: new Date().toISOString(),
      checks: body.checks ?? { passes: 0, fails: 0 },
      metrics: body.metrics ?? {},
      duration: body.duration ?? 0,
      vus: body.vus ?? 0,
    };

    try {
      const redis = getRedis();
      // Store per-script latest summary with 7-day TTL
      await redis.set(`k6:last:${script}`, JSON.stringify(record), "EX", 7 * 24 * 3600);
      // Also track the global most-recent run timestamp
      await redis.set("k6:latest", JSON.stringify(record), "EX", 7 * 24 * 3600);
    } catch {
      return NextResponse.json({ ok: false, error: "redis unavailable" }, { status: 503 });
    }

    return NextResponse.json({ ok: true, stored: record });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 400 }
    );
  }
}
