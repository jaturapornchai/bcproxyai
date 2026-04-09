import { NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";
import { getRedis } from "@/lib/redis";

export const dynamic = "force-dynamic";

interface Line {
  name: string;
  help: string;
  type: "gauge" | "counter";
  samples: Array<{ labels?: Record<string, string>; value: number }>;
}

function renderMetric(m: Line): string {
  const out: string[] = [];
  out.push(`# HELP ${m.name} ${m.help}`);
  out.push(`# TYPE ${m.name} ${m.type}`);
  for (const s of m.samples) {
    const labels = s.labels
      ? "{" +
        Object.entries(s.labels)
          .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`)
          .join(",") +
        "}"
      : "";
    out.push(`${m.name}${labels} ${s.value}`);
  }
  return out.join("\n");
}

async function safe<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch {
    return [];
  }
}

async function collectMetrics(): Promise<Line[]> {
  const sql = getSqlClient();

  const [
    modelsRows,
    examRows,
    gatewayRows,
    latencyRows,
    limitRows,
    failStreakRows,
    redisUsed,
  ] = await Promise.all([
    safe(
      () => sql<{ provider: string; total: number; active: number; cooldown: number }[]>`
        SELECT
          m.provider,
          COUNT(*)::int AS total,
          SUM(CASE WHEN h.cooldown_until IS NULL OR h.cooldown_until < now() THEN 1 ELSE 0 END)::int AS active,
          SUM(CASE WHEN h.cooldown_until > now() THEN 1 ELSE 0 END)::int AS cooldown
        FROM models m
        LEFT JOIN (
          SELECT DISTINCT ON (model_id) model_id, cooldown_until
          FROM health_logs ORDER BY model_id, id DESC
        ) h ON h.model_id = m.id
        GROUP BY m.provider
      `,
    ),
    safe(
      () => sql<{ provider: string; passed: number }[]>`
        SELECT m.provider, COUNT(*)::int AS passed
        FROM models m
        INNER JOIN (
          SELECT DISTINCT ON (model_id) model_id, passed
          FROM exam_attempts WHERE finished_at IS NOT NULL
          ORDER BY model_id, started_at DESC
        ) ea ON m.id = ea.model_id AND ea.passed = true
        GROUP BY m.provider
      `,
    ),
    safe(
      () => sql<{ status_class: string; count: number }[]>`
        SELECT
          CASE
            WHEN status BETWEEN 200 AND 299 THEN '2xx'
            WHEN status BETWEEN 400 AND 499 THEN '4xx'
            WHEN status BETWEEN 500 AND 599 THEN '5xx'
            ELSE 'other'
          END AS status_class,
          COUNT(*)::int AS count
        FROM gateway_logs
        WHERE created_at >= now() - interval '1 hour'
        GROUP BY status_class
      `,
    ),
    safe(
      () => sql<{ provider: string; p50: number; p99: number }[]>`
        SELECT
          provider,
          PERCENTILE_DISC(0.5) WITHIN GROUP (ORDER BY latency_ms)::int AS p50,
          PERCENTILE_DISC(0.99) WITHIN GROUP (ORDER BY latency_ms)::int AS p99
        FROM routing_stats
        WHERE created_at >= now() - interval '24 hours'
        GROUP BY provider
      `,
    ),
    safe(
      () => sql<
        {
          provider: string;
          model_id: string;
          remaining_tpm: number | null;
          remaining_tpd: number | null;
        }[]
      >`
        SELECT provider, model_id, remaining_tpm, remaining_tpd
        FROM provider_limits
        WHERE updated_at >= now() - interval '1 hour'
      `,
    ),
    safe(
      () => sql<{ active: number }[]>`
        SELECT COUNT(*)::int AS active FROM model_fail_streak WHERE streak_count > 0
      `,
    ),
    (async () => {
      try {
        const info = await getRedis().info("memory");
        const used = info.match(/used_memory:(\d+)/)?.[1];
        return used ? Number(used) : null;
      } catch {
        return null;
      }
    })(),
  ]);

  const metrics: Line[] = [];

  if (modelsRows.length > 0) {
    metrics.push({
      name: "bcproxy_models_total",
      help: "Total models per provider",
      type: "gauge",
      samples: modelsRows.map((r) => ({ labels: { provider: r.provider }, value: r.total })),
    });
    metrics.push({
      name: "bcproxy_models_active",
      help: "Active (non-cooldown) models per provider",
      type: "gauge",
      samples: modelsRows.map((r) => ({ labels: { provider: r.provider }, value: r.active })),
    });
    metrics.push({
      name: "bcproxy_models_cooldown",
      help: "Models in cooldown per provider",
      type: "gauge",
      samples: modelsRows.map((r) => ({ labels: { provider: r.provider }, value: r.cooldown })),
    });
  }

  if (examRows.length > 0) {
    metrics.push({
      name: "bcproxy_exam_passed",
      help: "Models that passed the most recent exam, per provider",
      type: "gauge",
      samples: examRows.map((r) => ({ labels: { provider: r.provider }, value: r.passed })),
    });
  }

  if (gatewayRows.length > 0) {
    metrics.push({
      name: "bcproxy_gateway_requests_1h",
      help: "Gateway requests in the last 1 hour, by status class",
      type: "gauge",
      samples: gatewayRows.map((r) => ({ labels: { status: r.status_class }, value: r.count })),
    });
  }

  if (latencyRows.length > 0) {
    metrics.push({
      name: "bcproxy_latency_p50_seconds",
      help: "Routing latency p50 (seconds) per provider, last 24h",
      type: "gauge",
      samples: latencyRows.map((r) => ({ labels: { provider: r.provider }, value: r.p50 / 1000 })),
    });
    metrics.push({
      name: "bcproxy_latency_p99_seconds",
      help: "Routing latency p99 (seconds) per provider, last 24h",
      type: "gauge",
      samples: latencyRows.map((r) => ({ labels: { provider: r.provider }, value: r.p99 / 1000 })),
    });
  }

  const limitSamples = limitRows.flatMap((r) => {
    const s: Array<{ labels: Record<string, string>; value: number }> = [];
    if (r.remaining_tpm != null) {
      s.push({
        labels: { provider: r.provider, model: r.model_id, type: "tpm" },
        value: r.remaining_tpm,
      });
    }
    if (r.remaining_tpd != null) {
      s.push({
        labels: { provider: r.provider, model: r.model_id, type: "tpd" },
        value: r.remaining_tpd,
      });
    }
    return s;
  });
  if (limitSamples.length > 0) {
    metrics.push({
      name: "bcproxy_provider_limit_remaining",
      help: "Learned provider limit remaining (tokens) per model",
      type: "gauge",
      samples: limitSamples,
    });
  }

  metrics.push({
    name: "bcproxy_active_fail_streaks",
    help: "Number of models currently in a fail streak (streak_count > 0)",
    type: "gauge",
    samples: [{ value: failStreakRows[0]?.active ?? 0 }],
  });

  if (redisUsed != null) {
    metrics.push({
      name: "bcproxy_redis_used_memory_bytes",
      help: "Valkey/Redis used memory in bytes",
      type: "gauge",
      samples: [{ value: redisUsed }],
    });
  }

  return metrics;
}

export async function GET() {
  try {
    const metrics = await collectMetrics();
    const body = metrics.map(renderMetric).join("\n\n") + "\n";
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return new NextResponse(`# metrics error: ${String(err)}\n`, {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
  }
}
