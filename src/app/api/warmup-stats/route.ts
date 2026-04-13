import { NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

interface WarmupLog {
  createdAt: string;
  message: string;
  level: string;
}

interface WarmupStats {
  totalPings24h: number;
  successRate: number;
  recentLogs: WarmupLog[];
  lastRunAt: string | null;
}

export async function GET() {
  try {
    const sql = getSqlClient();

    // Recent warmup logs
    const logs = await sql<WarmupLog[]>`
      SELECT created_at AS "createdAt", message, level
      FROM worker_logs
      WHERE step = 'warmup'
      ORDER BY created_at DESC
      LIMIT 30
    `;

    // Parse counts from log messages like "🔥 Pinged 30 models — 25 ok, 5 failed"
    let totalPings = 0;
    let totalOk = 0;
    const PING_RE = /Pinged\s+(\d+)\s+models\s+—\s+(\d+)\s+ok/i;
    for (const log of logs) {
      const match = PING_RE.exec(log.message);
      if (match) {
        totalPings += Number(match[1]);
        totalOk += Number(match[2]);
      }
    }

    const successRate =
      totalPings > 0 ? Math.round((totalOk / totalPings) * 1000) / 10 : 0;

    return NextResponse.json<WarmupStats>({
      totalPings24h: totalPings,
      successRate,
      recentLogs: logs,
      lastRunAt: logs[0]?.createdAt ?? null,
    });
  } catch {
    return NextResponse.json<WarmupStats>({
      totalPings24h: 0,
      successRate: 0,
      recentLogs: [],
      lastRunAt: null,
    });
  }
}
