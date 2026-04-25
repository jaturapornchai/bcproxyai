import { NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";
import { getCached, setCache } from "@/lib/cache";
import { isRedisHealthy } from "@/lib/redis";

export const dynamic = "force-dynamic";

interface HealthResult {
  status: "healthy" | "degraded" | "down";
  checks: {
    database: { ok: boolean; latencyMs: number };
    redis: { ok: boolean };
    providers: {
      total: number;
      available: number;
      cooldown: number;
      percentAvailable: number;
    };
    worker: {
      status: string;
      lastRun: string | null;
      minutesSinceLastRun: number;
    };
    gateway: {
      recentSuccessRate: number;
      avgLatencyMs: number;
    };
    minServingModels: number; // models that passed the exam (score>=50) and not in cooldown
  };
  alerts: string[];
}

// Minimum number of exam-passed, non-cooldown models below which the gateway
// is considered "not ready" (returns 503 to upstream load balancer).
const MIN_SERVING_MODELS = 3;

export async function GET() {
  try {
    const cached = getCached<HealthResult>("api:health");
    if (cached) return NextResponse.json(cached);

    const alerts: string[] = [];

    // --- Database check (fail-fast before parallel queries) ---
    let dbOk = false;
    let dbLatencyMs = 0;
    try {
      const sql = getSqlClient();
      const dbStart = Date.now();
      await sql`SELECT 1`;
      dbLatencyMs = Date.now() - dbStart;
      dbOk = true;
      if (dbLatencyMs > 100) {
        alerts.push(`Database latency สูง (${dbLatencyMs}ms > 100ms)`);
      }
    } catch {
      alerts.push("Database ไม่สามารถเชื่อมต่อได้");
      const result: HealthResult = {
        status: "down",
        checks: {
          database: { ok: false, latencyMs: 0 },
          redis: { ok: false },
          providers: { total: 0, available: 0, cooldown: 0, percentAvailable: 0 },
          worker: { status: "unknown", lastRun: null, minutesSinceLastRun: -1 },
          gateway: { recentSuccessRate: 0, avgLatencyMs: 0 },
          minServingModels: 0,
        },
        alerts,
      };
      return NextResponse.json(result, { status: 503 });
    }

    const sql = getSqlClient();

    // --- All checks in parallel ---
    const [
      redisOk,
      totalRows,
      availableRows,
      cooldownRows,
      workerRows,
      gatewayRows,
      latencyRows,
      minServingRows,
    ] = await Promise.all([
      isRedisHealthy(),
      sql<{ count: number }[]>`SELECT COUNT(*) as count FROM models`,
      sql<{ count: number }[]>`
        SELECT COUNT(DISTINCT m.id) as count
        FROM models m
        LEFT JOIN latest_model_health h ON m.id = h.model_id
        WHERE (h.status IS NULL OR h.status = 'available' OR h.status = 'error')
          AND (h.cooldown_until IS NULL OR h.cooldown_until <= now())
      `,
      sql<{ count: number }[]>`
        SELECT COUNT(*) as count
        FROM latest_model_health
        WHERE cooldown_until > now()
      `,
      sql<{ key: string; value: string }[]>`
        SELECT key, value FROM worker_state WHERE key IN ('status', 'last_run')
      `,
      sql<{ status: number }[]>`
        SELECT status FROM gateway_logs ORDER BY created_at DESC LIMIT 100
      `,
      sql<{ avg: number | null }[]>`
        SELECT AVG(latency_ms) as avg FROM (
          SELECT latency_ms FROM gateway_logs ORDER BY created_at DESC LIMIT 100
        ) sub
      `,
      sql<{ count: number }[]>`
        SELECT COUNT(DISTINCT m.id) as count FROM models m
        WHERE EXISTS (
          SELECT 1 FROM exam_attempts e
          WHERE e.model_id = m.id
            AND e.finished_at IS NOT NULL
            AND e.passed = true
            AND e.score_pct >= 50
            AND e.started_at > now() - interval '7 days'
        )
        AND NOT EXISTS (
          SELECT 1 FROM latest_model_health h
          WHERE h.model_id = m.id
            AND h.cooldown_until IS NOT NULL
            AND h.cooldown_until > now()
        )
      `,
    ]);

    if (!redisOk) alerts.push("Redis ping ล้มเหลว — semantic cache + leader lock เสีย");

    // --- Provider availability ---
    const total = Number(totalRows[0]?.count ?? 0);
    const available = Number(availableRows[0]?.count ?? 0);
    const cooldown = Number(cooldownRows[0]?.count ?? 0);
    const percentAvailable = total > 0 ? Math.round((available / total) * 100) : 0;

    if (percentAvailable === 0 && total > 0) {
      alerts.push("ทุกโมเดลติด cooldown — อาจถูก rate limit ทั้งหมด");
    }

    // --- Worker status ---
    const workerMap = new Map(workerRows.map(r => [r.key, r.value]));
    const workerStatus = workerMap.get("status") ?? "unknown";
    const lastRun = workerMap.get("last_run") ?? null;

    let minutesSinceLastRun = -1;
    if (lastRun) {
      const lastRunDate = new Date(lastRun);
      minutesSinceLastRun = Math.round((Date.now() - lastRunDate.getTime()) / 60000);
      const hoursSince = minutesSinceLastRun / 60;
      if (hoursSince >= 2) {
        alerts.push(`Worker ไม่ทำงานมา ${Math.round(hoursSince * 10) / 10} ชม.`);
      }
    } else {
      alerts.push("Worker ยังไม่เคยทำงาน");
    }

    // --- Gateway success rate ---
    let recentSuccessRate = 100;
    let avgLatencyMs = 0;
    if (gatewayRows.length > 0) {
      const successCount = gatewayRows.filter(r => r.status >= 200 && r.status < 300).length;
      recentSuccessRate = Math.round((successCount / gatewayRows.length) * 100);
      avgLatencyMs = Math.round(latencyRows[0]?.avg ?? 0);
    }

    if (recentSuccessRate < 50) {
      alerts.push(`Success rate ต่ำกว่า 50% (${recentSuccessRate}%)`);
    }

    // --- Min serving models ---
    // Uses "ever passed in last 7 days" instead of "latest attempt passed" so
    // a single bad exam day (e.g. exam_level temporarily bumped to "university",
    // worker re-exam burst hits rate limits) doesn't drop readiness to 0 and
    // make Caddy yank the gateway out of rotation. Routing in /v1/* picks from
    // the same pool, so this matches what the gateway can actually serve.
    const minServingModels = Number(minServingRows[0]?.count ?? 0);
    if (minServingModels < MIN_SERVING_MODELS) {
      alerts.push(`เหลือ model พร้อมใช้แค่ ${minServingModels} (ต้องการอย่างน้อย ${MIN_SERVING_MODELS})`);
    }

    let status: "healthy" | "degraded" | "down" = "healthy";
    // Hard "down" = LB should pull us from rotation. Use signals that *actually*
    // mean we can't serve traffic, not derived metrics like exam scores
    // (which get poisoned by Thai-quality penalty rows + manual exam-resets).
    //
    // Real "down" = (a) DB unreachable OR (b) zero providers can answer at all.
    if (!dbOk || (total > 0 && available === 0)) {
      status = "down";
    } else if (
      !redisOk ||
      minServingModels < MIN_SERVING_MODELS ||
      percentAvailable <= 20 ||
      minutesSinceLastRun >= 120 ||
      recentSuccessRate <= 50 ||
      dbLatencyMs > 100
    ) {
      status = "degraded";
    }

    const result: HealthResult = {
      status,
      checks: {
        database: { ok: dbOk, latencyMs: dbLatencyMs },
        redis: { ok: redisOk },
        providers: { total, available, cooldown, percentAvailable },
        worker: { status: workerStatus, lastRun, minutesSinceLastRun },
        gateway: { recentSuccessRate, avgLatencyMs },
        minServingModels,
      },
      alerts,
    };

    setCache("api:health", result, 15000);
    // 503 only when we truly can't serve — load balancer should pull us out.
    // "degraded" still returns 200 so observers can see the warning without
    // triggering failover storms.
    const httpStatus = status === "down" ? 503 : 200;
    return NextResponse.json(result, { status: httpStatus });
  } catch (err) {
    console.error("[health] error:", err);
    return NextResponse.json(
      {
        status: "down",
        checks: {
          database: { ok: false, latencyMs: 0 },
          redis: { ok: false },
          providers: { total: 0, available: 0, cooldown: 0, percentAvailable: 0 },
          worker: { status: "unknown", lastRun: null, minutesSinceLastRun: -1 },
          gateway: { recentSuccessRate: 0, avgLatencyMs: 0 },
          minServingModels: 0,
        },
        alerts: [`Internal error: ${String(err)}`],
      },
      { status: 500 }
    );
  }
}
