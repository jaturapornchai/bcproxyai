import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();

    // 1. Provider success rate (last 24 hours)
    const providerStats = db
      .prepare(
        `SELECT
           provider,
           COUNT(*) as total,
           SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) as success,
           ROUND(
             SUM(CASE WHEN status >= 200 AND status < 300 THEN 1.0 ELSE 0.0 END) / COUNT(*) * 100,
             1
           ) as successRate,
           ROUND(AVG(latency_ms)) as avgLatencyMs
         FROM gateway_logs
         WHERE created_at >= datetime('now', '-24 hours')
         GROUP BY provider
         ORDER BY total DESC`
      )
      .all() as { provider: string; total: number; success: number; successRate: number; avgLatencyMs: number }[];

    // 2. Hourly volume (last 24 hours)
    const hourlyRaw = db
      .prepare(
        `SELECT
           strftime('%H', created_at) as hour,
           COUNT(*) as total,
           SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) as success,
           SUM(CASE WHEN status < 200 OR status >= 300 THEN 1 ELSE 0 END) as failed
         FROM gateway_logs
         WHERE created_at >= datetime('now', '-24 hours')
         GROUP BY strftime('%H', created_at)
         ORDER BY hour`
      )
      .all() as { hour: string; total: number; success: number; failed: number }[];

    // Fill missing hours with zeros
    const hourMap = new Map(hourlyRaw.map((h) => [h.hour, h]));
    const hourlyVolume = Array.from({ length: 24 }, (_, i) => {
      const hour = String(i).padStart(2, "0");
      return hourMap.get(hour) ?? { hour, total: 0, success: 0, failed: 0 };
    });

    // 3. Top models by usage
    const topModels = db
      .prepare(
        `SELECT
           COALESCE(resolved_model, request_model) as model,
           provider,
           COUNT(*) as count,
           ROUND(AVG(latency_ms)) as avgLatencyMs
         FROM gateway_logs
         WHERE created_at >= datetime('now', '-24 hours')
         GROUP BY COALESCE(resolved_model, request_model), provider
         ORDER BY count DESC
         LIMIT 10`
      )
      .all() as { model: string; provider: string; count: number; avgLatencyMs: number }[];

    // 4. Daily token usage (last 7 days)
    const dailyTokens = db
      .prepare(
        `SELECT
           strftime('%Y-%m-%d', created_at) as date,
           SUM(input_tokens) as input,
           SUM(output_tokens) as output
         FROM token_usage
         WHERE created_at >= datetime('now', '-7 days')
         GROUP BY strftime('%Y-%m-%d', created_at)
         ORDER BY date`
      )
      .all() as { date: string; input: number; output: number }[];

    return NextResponse.json({
      providerStats,
      hourlyVolume,
      topModels,
      dailyTokens,
    });
  } catch (err) {
    console.error("[analytics] error:", err);
    return NextResponse.json(
      { providerStats: [], hourlyVolume: [], topModels: [], dailyTokens: [] },
      { status: 500 }
    );
  }
}
