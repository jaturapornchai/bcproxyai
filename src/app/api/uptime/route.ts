import { NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sql = getSqlClient();

    const uptimeStats = await sql<{
      provider: string; total_checks: number; available_checks: number;
      uptime_pct: number; avg_latency_ms: number | null;
    }[]>`
      SELECT
        m.provider,
        COUNT(*) as total_checks,
        SUM(CASE WHEN h.status = 'available' THEN 1 ELSE 0 END) as available_checks,
        ROUND(
          (SUM(CASE WHEN h.status = 'available' THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100),
          1
        ) as uptime_pct,
        ROUND(AVG(CASE WHEN h.status = 'available' THEN h.latency_ms ELSE NULL END)::numeric) as avg_latency_ms
      FROM health_logs h
      JOIN models m ON h.model_id = m.id
      WHERE h.checked_at >= now() - interval '24 hours'
      GROUP BY m.provider
      ORDER BY uptime_pct DESC
    `;

    const dailyUptime = await sql<{ date: string; provider: string; uptime_pct: number }[]>`
      SELECT
        to_char(h.checked_at, 'YYYY-MM-DD') as date,
        m.provider,
        ROUND(
          (SUM(CASE WHEN h.status = 'available' THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100),
          1
        ) as uptime_pct
      FROM health_logs h
      JOIN models m ON h.model_id = m.id
      WHERE h.checked_at >= now() - interval '7 days'
      GROUP BY to_char(h.checked_at, 'YYYY-MM-DD'), m.provider
      ORDER BY date, m.provider
    `;

    const incidents = await sql<{
      checked_at: Date; provider: string; model_id: string; nickname: string | null;
      status: string; error: string | null; cooldown_until: Date | null;
    }[]>`
      SELECT
        h.checked_at, m.provider, m.model_id, m.nickname, h.status, h.error, h.cooldown_until
      FROM health_logs h
      JOIN models m ON h.model_id = m.id
      WHERE h.checked_at >= now() - interval '24 hours'
        AND h.status NOT IN ('available')
      ORDER BY h.checked_at DESC
      LIMIT 30
    `;

    const cooldownCounts = await sql<{ provider: string; cooldown_count: number }[]>`
      SELECT m.provider, COUNT(DISTINCT m.id) as cooldown_count
      FROM health_logs h
      JOIN models m ON h.model_id = m.id
      WHERE h.cooldown_until > now()
      GROUP BY m.provider
    `;

    return NextResponse.json({ uptimeStats, dailyUptime, incidents, cooldownCounts });
  } catch (err) {
    console.error("[uptime] error:", err);
    return NextResponse.json({ uptimeStats: [], dailyUptime: [], incidents: [], cooldownCounts: [] }, { status: 500 });
  }
}
