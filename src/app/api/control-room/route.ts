import { NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";
import { getRedis } from "@/lib/redis";
import { getPerfCounts } from "@/lib/perf-counters";

export const dynamic = "force-dynamic";

/**
 * /api/control-room — single-call dashboard snapshot.
 *
 * Aggregates the data the live Control Room panel needs into one round-trip
 * so the FE doesn't fan out to 5+ endpoints. Each section degrades to an
 * empty/zero shape if its underlying source is unavailable, so a Redis or
 * pgvector outage doesn't fail the whole call.
 *
 * Window is the last hour by default. Override with `?windowMin=N` (1–1440).
 */

interface ProviderRowAgg {
  provider: string;
  total: number;
  errors: number;
  avg_ms: number;
  p95: number;
}

interface ModelRowAgg {
  resolved_model: string;
  provider: string;
  total: number;
  errors: number;
  avg_ms: number;
}

interface RecentError {
  request_model: string;
  provider: string | null;
  status: number;
  error: string | null;
  created_at: string;
}

async function scanCount(pattern: string): Promise<number> {
  try {
    const redis = getRedis();
    let cursor = "0";
    let count = 0;
    do {
      const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
      count += batch.length;
      cursor = next;
    } while (cursor !== "0");
    return count;
  } catch {
    return 0;
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rawWin = Number(url.searchParams.get("windowMin"));
    const windowMin = Number.isFinite(rawWin) && rawWin > 0
      ? Math.min(Math.max(Math.floor(rawWin), 1), 1440)
      : 60;
    const windowExpr = `${windowMin} minutes`;

    const sql = getSqlClient();

    // Run independent queries in parallel — they all hit different tables.
    const [
      workerRows,
      cooldownRows,
      reqStatsRows,
      providerBreak,
      topModels,
      recentErrors,
      cacheTotalRows,
      perfCounts,
      openCircuits,
      halfOpenCircuits,
    ] = await Promise.all([
      sql<{ key: string; value: string }[]>`
        SELECT key, value FROM worker_state
        WHERE key IN ('status', 'last_run', 'next_run', 'judge_model')
      `,
      sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM latest_model_health WHERE cooldown_until > now()
      `,
      sql<{ total: number; errors: number; avg_ms: number; p50: number; p95: number }[]>`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status >= 400)::int AS errors,
          COALESCE(AVG(latency_ms), 0)::int AS avg_ms,
          COALESCE(percentile_cont(0.5)  WITHIN GROUP (ORDER BY latency_ms), 0)::int AS p50,
          COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)::int AS p95
        FROM gateway_logs
        WHERE created_at > now() - ${windowExpr}::interval
      `,
      sql<ProviderRowAgg[]>`
        SELECT
          COALESCE(provider, 'unknown') AS provider,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status >= 400)::int AS errors,
          COALESCE(AVG(latency_ms), 0)::int AS avg_ms,
          COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)::int AS p95
        FROM gateway_logs
        WHERE created_at > now() - ${windowExpr}::interval
        GROUP BY provider
        ORDER BY total DESC
        LIMIT 20
      `,
      sql<ModelRowAgg[]>`
        SELECT
          resolved_model,
          COALESCE(provider, 'unknown') AS provider,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status >= 400)::int AS errors,
          COALESCE(AVG(latency_ms), 0)::int AS avg_ms
        FROM gateway_logs
        WHERE created_at > now() - ${windowExpr}::interval
          AND resolved_model IS NOT NULL
        GROUP BY resolved_model, provider
        ORDER BY total DESC
        LIMIT 20
      `,
      sql<RecentError[]>`
        SELECT request_model, provider, status, error, created_at::text
        FROM gateway_logs
        WHERE created_at > now() - ${windowExpr}::interval
          AND status >= 400
        ORDER BY created_at DESC
        LIMIT 10
      `,
      sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM semantic_cache
      `.catch(() => [{ count: 0 }]),
      getPerfCounts().catch(() => null),
      scanCount("cb:open:*"),
      scanCount("cb:half-open:*"),
    ]);

    const workerMap = new Map(workerRows.map((r) => [r.key, r.value]));
    const reqStats = reqStatsRows[0] ?? { total: 0, errors: 0, avg_ms: 0, p50: 0, p95: 0 };
    const cacheHits = perfCounts?.["cache:hit"] ?? 0;
    const cacheMiss = perfCounts?.["cache:miss"] ?? 0;
    const cacheLookups = cacheHits + cacheMiss;

    return NextResponse.json({
      windowMin,
      worker: {
        status: workerMap.get("status") ?? "idle",
        lastRun: workerMap.get("last_run") ?? null,
        nextRun: workerMap.get("next_run") ?? null,
        judgeModel: workerMap.get("judge_model") ?? null,
      },
      requests: {
        total: reqStats.total,
        errors: reqStats.errors,
        errorRate: reqStats.total > 0 ? reqStats.errors / reqStats.total : 0,
        avgMs: reqStats.avg_ms,
        p50Ms: reqStats.p50,
        p95Ms: reqStats.p95,
      },
      cooldownModels: Number(cooldownRows[0]?.count ?? 0),
      providers: providerBreak.map((p) => ({
        provider: p.provider,
        total: p.total,
        errors: p.errors,
        errorRate: p.total > 0 ? p.errors / p.total : 0,
        avgMs: p.avg_ms,
        p95Ms: p.p95,
      })),
      topModels: topModels.map((m) => ({
        model: m.resolved_model,
        provider: m.provider,
        total: m.total,
        errors: m.errors,
        errorRate: m.total > 0 ? m.errors / m.total : 0,
        avgMs: m.avg_ms,
      })),
      recentErrors: recentErrors.map((e) => ({
        model: e.request_model,
        provider: e.provider,
        status: e.status,
        // Trim error string defensively — gateway_logs.error can hold full
        // upstream stack traces. Surface what the operator needs to triage.
        error: e.error?.slice(0, 200) ?? null,
        at: e.created_at,
      })),
      cache: {
        responseCache: {
          hits: cacheHits,
          misses: cacheMiss,
          hitRate: cacheLookups > 0 ? cacheHits / cacheLookups : 0,
        },
        semanticEntries: Number(cacheTotalRows[0]?.count ?? 0),
      },
      circuits: {
        open: openCircuits,
        halfOpen: halfOpenCircuits,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 500 });
  }
}
