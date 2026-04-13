import { getSqlClient } from "@/lib/db/schema";
import { getRedis } from "@/lib/redis";

export const dynamic = "force-dynamic";

// Prometheus exposition format — /api/metrics
// เป้าหมาย: แสดงสถานะ gateway ทั้งหมดแบบ scrape ได้ด้วย Prometheus
// กฎ: query ใดพังให้เซ็ต metric = 0 (ห้ามทำ endpoint ตายทั้งชุด)

const MAX_GROUP_ROWS = 500; // กัน response ใหญ่เกิน ~100KB

function escapeLabel(v: string): string {
  return String(v ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

type Labels = Record<string, string | number | null | undefined>;

function fmtLabels(labels: Labels): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(labels)) {
    if (v === null || v === undefined) continue;
    parts.push(`${k}="${escapeLabel(String(v))}"`);
  }
  return parts.length ? `{${parts.join(",")}}` : "";
}

class MetricBuffer {
  private lines: string[] = [];

  help(name: string, help: string, type: "gauge" | "counter"): void {
    this.lines.push(`# HELP ${name} ${help}`);
    this.lines.push(`# TYPE ${name} ${type}`);
  }

  sample(name: string, labels: Labels, value: number): void {
    const v = Number.isFinite(value) ? value : 0;
    this.lines.push(`${name}${fmtLabels(labels)} ${v}`);
  }

  toString(): string {
    return this.lines.join("\n") + "\n";
  }
}

// percentile จาก list ตัวเลข (เรียงแล้ว)
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((p / 100) * sorted.length)),
  );
  return sorted[idx] ?? 0;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn("[metrics] query failed:", (err as Error)?.message ?? err);
    return fallback;
  }
}

type ModelsRow = { provider: string; status: string; count: number };
type ExamRow = { provider: string; count: number };
type CooldownRow = { provider: string; count: number };
type RequestRow = { status: number; count: number };
type LatencyRow = { provider: string; p50: number; p99: number };
type LatencyFallbackRow = { provider: string; latency_ms: number };
type LimitsRow = {
  provider: string;
  model_id: string;
  remaining_tpm: number | null;
  remaining_tpd: number | null;
};

export async function GET(): Promise<Response> {
  const sql = getSqlClient();

  // ดึงทุก metric พร้อมกัน — แต่ละ query ถูก wrap ด้วย safe() จึงพังเดี่ยวได้
  const [
    modelsRows,
    examRows,
    cooldownRows,
    requestRows,
    latencyRows,
    cacheRatio,
    limitsRows,
  ] = await Promise.all([
    safe<ModelsRow[]>(
      () => sql<ModelsRow[]>`
        SELECT
          m.provider,
          CASE
            WHEN h.cooldown_until IS NOT NULL AND h.cooldown_until > now()
              THEN 'cooldown'
            ELSE 'available'
          END AS status,
          COUNT(*)::int AS count
        FROM models m
        LEFT JOIN LATERAL (
          SELECT cooldown_until FROM health_logs
          WHERE model_id = m.id
          ORDER BY id DESC LIMIT 1
        ) h ON true
        GROUP BY m.provider, status
        LIMIT ${MAX_GROUP_ROWS}
      `,
      [],
    ),
    safe<ExamRow[]>(
      () => sql<ExamRow[]>`
        SELECT m.provider, COUNT(DISTINCT m.id)::int AS count
        FROM models m
        INNER JOIN LATERAL (
          SELECT passed FROM exam_attempts
          WHERE model_id = m.id
          ORDER BY started_at DESC LIMIT 1
        ) e ON true
        WHERE e.passed = true
        GROUP BY m.provider
        LIMIT ${MAX_GROUP_ROWS}
      `,
      [],
    ),
    safe<CooldownRow[]>(
      () => sql<CooldownRow[]>`
        SELECT m.provider, COUNT(DISTINCT m.id)::int AS count
        FROM models m
        INNER JOIN LATERAL (
          SELECT cooldown_until FROM health_logs
          WHERE model_id = m.id
          ORDER BY id DESC LIMIT 1
        ) h ON true
        WHERE h.cooldown_until IS NOT NULL AND h.cooldown_until > now()
        GROUP BY m.provider
        LIMIT ${MAX_GROUP_ROWS}
      `,
      [],
    ),
    safe<RequestRow[]>(
      () => sql<RequestRow[]>`
        SELECT status, COUNT(*)::int AS count
        FROM gateway_logs
        WHERE created_at >= now() - interval '24 hours'
        GROUP BY status
        LIMIT ${MAX_GROUP_ROWS}
      `,
      [],
    ),
    safe<LatencyRow[]>(
      () => sql<LatencyRow[]>`
        SELECT
          COALESCE(provider, 'unknown') AS provider,
          (percentile_cont(0.50) WITHIN GROUP (ORDER BY latency_ms))::float AS p50,
          (percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms))::float AS p99
        FROM gateway_logs
        WHERE created_at >= now() - interval '24 hours'
          AND latency_ms > 0
        GROUP BY provider
        LIMIT ${MAX_GROUP_ROWS}
      `,
      [],
    ),
    (async () => {
      try {
        const redis = getRedis();
        const [hitsRaw, missesRaw] = await Promise.all([
          redis.get("sml:cache:hits").catch(() => null),
          redis.get("sml:cache:misses").catch(() => null),
        ]);
        const hits = Number(hitsRaw ?? 0);
        const misses = Number(missesRaw ?? 0);
        const total = hits + misses;
        return total > 0 ? hits / total : 0;
      } catch {
        return 0;
      }
    })(),
    safe<LimitsRow[]>(
      () => sql<LimitsRow[]>`
        SELECT provider, model_id, remaining_tpm, remaining_tpd
        FROM provider_limits
        ORDER BY updated_at DESC
        LIMIT ${MAX_GROUP_ROWS}
      `,
      [],
    ),
  ]);

  // latency fallback: ถ้า gateway_logs ว่าง ลอง routing_stats
  let latencyP50: { provider: string; seconds: number }[] = [];
  let latencyP99: { provider: string; seconds: number }[] = [];
  if (latencyRows.length > 0) {
    latencyP50 = latencyRows.map((r) => ({
      provider: r.provider,
      seconds: (Number(r.p50) || 0) / 1000,
    }));
    latencyP99 = latencyRows.map((r) => ({
      provider: r.provider,
      seconds: (Number(r.p99) || 0) / 1000,
    }));
  } else {
    const fallback = await safe<LatencyFallbackRow[]>(
      () => sql<LatencyFallbackRow[]>`
        SELECT provider, latency_ms FROM routing_stats
        WHERE created_at >= now() - interval '24 hours' AND latency_ms > 0
        LIMIT 10000
      `,
      [],
    );
    const byProvider = new Map<string, number[]>();
    for (const r of fallback) {
      const arr = byProvider.get(r.provider) ?? [];
      arr.push(Number(r.latency_ms) || 0);
      byProvider.set(r.provider, arr);
    }
    for (const [provider, arr] of byProvider) {
      arr.sort((a, b) => a - b);
      latencyP50.push({ provider, seconds: percentile(arr, 50) / 1000 });
      latencyP99.push({ provider, seconds: percentile(arr, 99) / 1000 });
    }
  }

  // Emit buffer แบบ deterministic
  const buf = new MetricBuffer();

  buf.help(
    "sml_models_total",
    "Total registered models grouped by provider and health status (available|cooldown).",
    "gauge",
  );
  if (modelsRows.length === 0) {
    buf.sample("sml_models_total", { provider: "unknown", status: "available" }, 0);
  } else {
    for (const r of modelsRows) {
      buf.sample(
        "sml_models_total",
        { provider: r.provider, status: r.status },
        Number(r.count) || 0,
      );
    }
  }

  buf.help(
    "sml_exam_passed_total",
    "Models whose latest exam attempt passed, grouped by provider.",
    "gauge",
  );
  if (examRows.length === 0) {
    buf.sample("sml_exam_passed_total", { provider: "unknown" }, 0);
  } else {
    for (const r of examRows) {
      buf.sample("sml_exam_passed_total", { provider: r.provider }, Number(r.count) || 0);
    }
  }

  buf.help(
    "sml_cooldown_active_total",
    "Models currently in cooldown (latest health_log.cooldown_until > now), grouped by provider.",
    "gauge",
  );
  if (cooldownRows.length === 0) {
    buf.sample("sml_cooldown_active_total", { provider: "unknown" }, 0);
  } else {
    for (const r of cooldownRows) {
      buf.sample(
        "sml_cooldown_active_total",
        { provider: r.provider },
        Number(r.count) || 0,
      );
    }
  }

  buf.help(
    "sml_request_total",
    "Gateway requests in the last 24h grouped by HTTP status code (approximated from gateway_logs).",
    "counter",
  );
  if (requestRows.length === 0) {
    buf.sample("sml_request_total", { status: "0" }, 0);
  } else {
    for (const r of requestRows) {
      buf.sample(
        "sml_request_total",
        { status: String(r.status ?? 0) },
        Number(r.count) || 0,
      );
    }
  }

  buf.help(
    "sml_latency_p50_seconds",
    "p50 latency per provider (seconds) computed from gateway_logs over last 24h.",
    "gauge",
  );
  if (latencyP50.length === 0) {
    buf.sample("sml_latency_p50_seconds", { provider: "unknown" }, 0);
  } else {
    for (const r of latencyP50) {
      buf.sample("sml_latency_p50_seconds", { provider: r.provider }, r.seconds);
    }
  }

  buf.help(
    "sml_latency_p99_seconds",
    "p99 latency per provider (seconds) computed from gateway_logs over last 24h.",
    "gauge",
  );
  if (latencyP99.length === 0) {
    buf.sample("sml_latency_p99_seconds", { provider: "unknown" }, 0);
  } else {
    for (const r of latencyP99) {
      buf.sample("sml_latency_p99_seconds", { provider: r.provider }, r.seconds);
    }
  }

  buf.help(
    "sml_cache_hit_ratio",
    "Response cache hit ratio (hits / (hits+misses)) from Redis counters; 0 if counters absent.",
    "gauge",
  );
  buf.sample("sml_cache_hit_ratio", {}, cacheRatio);

  buf.help(
    "sml_provider_limit_remaining",
    "Remaining provider quota from provider_limits table. type=tpm|tpd|rpm.",
    "gauge",
  );
  if (limitsRows.length === 0) {
    buf.sample(
      "sml_provider_limit_remaining",
      { provider: "unknown", model: "unknown", type: "tpm" },
      0,
    );
  } else {
    for (const r of limitsRows) {
      if (r.remaining_tpm !== null && r.remaining_tpm !== undefined) {
        buf.sample(
          "sml_provider_limit_remaining",
          { provider: r.provider, model: r.model_id, type: "tpm" },
          Number(r.remaining_tpm) || 0,
        );
      }
      if (r.remaining_tpd !== null && r.remaining_tpd !== undefined) {
        buf.sample(
          "sml_provider_limit_remaining",
          { provider: r.provider, model: r.model_id, type: "tpd" },
          Number(r.remaining_tpd) || 0,
        );
      }
    }
  }

  return new Response(buf.toString(), {
    headers: { "Content-Type": "text/plain; version=0.0.4" },
  });
}
