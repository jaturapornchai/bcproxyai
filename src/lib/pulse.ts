/**
 * Live gateway pulse: health status + activity snapshot for the landing page.
 *
 *   getHealth()           → full /api/health report (public callers only ever see `status`)
 *   buildPulse(scope, ?)  → PulseData (src/lib/pulse-types.ts)
 *
 * Reads only routing metadata from gateway_logs — never user_message, assistant_message,
 * error, client_ip or request_id. The public scope also drops every provider/model name:
 * stars get a daily-rotating HMAC id and events an opaque HMAC id.
 */
import { createHmac, randomBytes } from "node:crypto";
import { getSqlClient } from "@/lib/db/schema";
import { getCached, setCache } from "@/lib/cache";
import { isRedisHealthy } from "@/lib/redis";
import { ensureApiKeysLoaded, hasProviderKey } from "@/lib/api-keys";
import { getCostAllowedProviders, isModelCostAllowed, isProviderCostAllowed } from "@/lib/cost-policy";
import { getAllProviderToggles } from "@/lib/provider-toggle";
import type { ProviderStatus, PulseData, PulseEvent, PulseMinute, PulseRoute, PulseStar } from "@/lib/pulse-types";

// ─── Health ────────────────────────────────────────────────────────────────

export interface HealthResult {
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

const DOWN_CHECKS: HealthResult["checks"] = {
  database: { ok: false, latencyMs: 0 },
  redis: { ok: false },
  providers: { total: 0, available: 0, cooldown: 0, percentAvailable: 0 },
  worker: { status: "unknown", lastRun: null, minutesSinceLastRun: -1 },
  gateway: { recentSuccessRate: 0, avgLatencyMs: 0 },
  minServingModels: 0,
};

/** Full health report + the HTTP status /api/health answers with (Caddy health checks depend on it). */
export async function getHealth(): Promise<{ body: HealthResult; httpStatus: number }> {
  try {
    // ponytail: a cached report always answers 200 (unchanged behaviour), even if it says "down".
    const cached = getCached<HealthResult>("api:health");
    if (cached) return { body: cached, httpStatus: 200 };

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
      return { body: { status: "down", checks: DOWN_CHECKS, alerts }, httpStatus: 503 };
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

    const body: HealthResult = {
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

    setCache("api:health", body, 15000);
    // 503 only when we truly can't serve — load balancer should pull us out.
    // "degraded" still returns 200 so observers can see the warning without
    // triggering failover storms.
    // Provider availability is shared state (same DB for every replica), so pulling this instance out of rotation
    // cannot help — it would only take the landing/login down too. 503 = this instance cannot reach its DB.
    return { body, httpStatus: dbOk ? 200 : 503 };
  } catch (err) {
    console.error("[health] error:", err);
    return {
      body: { status: "down", checks: DOWN_CHECKS, alerts: [`Internal error: ${String(err)}`] },
      httpStatus: 500,
    };
  }
}

// ─── Pulse ─────────────────────────────────────────────────────────────────

export type PulseScope = PulseData["scope"];

interface ProviderRow { provider: string; label: string; hasKey: boolean; models: number; available: number }
interface ModelHourRow { provider: string; model: string; requests: number; ok: number; p50: number }
interface EventRow {
  id: string;
  createdAt: Date;
  provider: string | null;
  requestModel: string;
  model: string | null;
  status: number;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  route: PulseRoute | null;
}

/** Everything buildPulse reads from the DB, before scope shaping. */
export interface PulseSnapshot {
  health: HealthResult["status"];
  hour: { requests: number; ok: number; p50: number };
  today: number;
  series: PulseMinute[];
  providers: ProviderRow[];
  modelsHour: ModelHourRow[];
  /** oldest first */
  events: EventRow[];
}

const EVENT_WINDOW_MS = 15 * 60_000;
const CACHE_MS = 2_000;
const PROVIDERS_CACHE_MS = 15_000; // model health only moves every worker tick
const TOP_MODELS = 8;

// ponytail: random fallback in local mode (no auth secret) → public ids reshuffle on restart.
const SECRET = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || randomBytes(32).toString("hex");
const hmac = (data: string) => createHmac("sha256", SECRET).update(data).digest("hex");

/** Public star id: rotates every UTC day so it can't be pinned to a provider over time. */
export function publicStarId(provider: string, now = new Date()): string {
  return "s" + hmac(now.toISOString().slice(0, 10) + provider).slice(0, 6);
}

const publicEventId = (logId: string) => "e" + hmac("event:" + logId).slice(0, 12);
const ratio = (ok: number, total: number) => (total > 0 ? Math.round((ok / total) * 1000) / 1000 : 1);

function starStatus(p: ProviderRow, load: number, ok: number): ProviderStatus {
  if (!p.hasKey) return "nokey";
  if (p.available === 0) return "down";
  // ponytail: fixed heuristic — under half the models up, or <80% success over ≥5 requests in the last hour.
  if (p.available * 2 < p.models || (load >= 5 && ok / load < 0.8)) return "degraded";
  return "up";
}

/** Pure scope shaping. Public output carries no provider/model names and no owner-only keys. */
export function shapePulse(scope: PulseScope, snap: PulseSnapshot, now = new Date()): PulseData {
  const owner = scope === "owner";
  const visible = new Set(snap.providers.map((p) => p.provider));
  const starId = (provider: string | null) =>
    !provider || !visible.has(provider) ? "" : owner ? provider : publicStarId(provider, now);

  const loadBy = new Map<string, { load: number; ok: number }>();
  for (const m of snap.modelsHour) {
    const cur = loadBy.get(m.provider) ?? { load: 0, ok: 0 };
    loadBy.set(m.provider, { load: cur.load + m.requests, ok: cur.ok + m.ok });
  }

  const stars: PulseStar[] = snap.providers
    .map((p) => {
      const { load, ok } = loadBy.get(p.provider) ?? { load: 0, ok: 0 };
      const base = { id: starId(p.provider), status: starStatus(p, load, ok), load };
      return owner ? { ...base, label: p.label, models: p.models, available: p.available } : base;
    })
    .sort((a, b) => a.id.localeCompare(b.id)); // public: HMAC order, so position leaks nothing

  const events: PulseEvent[] = snap.events.map((e) => {
    const base = {
      id: owner ? e.id : publicEventId(e.id),
      t: e.createdAt.toISOString(),
      star: starId(e.provider),
      ok: e.status >= 200 && e.status < 300,
      latencyMs: e.latencyMs,
    };
    if (!owner) return base;
    return {
      ...base,
      model: e.model ?? undefined,
      requestModel: e.requestModel,
      status: e.status,
      tokensIn: e.tokensIn,
      tokensOut: e.tokensOut,
      route: e.route ?? undefined,
    };
  });

  const data: PulseData = {
    scope,
    generatedAt: now.toISOString(),
    status: snap.health === "healthy" ? "ok" : snap.health,
    stats: {
      requestsLastHour: snap.hour.requests,
      requestsToday: snap.today,
      successRate: ratio(snap.hour.ok, snap.hour.requests),
      p50LatencyMs: snap.hour.p50,
      providersUp: stars.filter((s) => s.status === "up" || s.status === "degraded").length,
      providersTotal: stars.length,
      modelsAvailable: snap.providers.reduce((n, p) => n + p.available, 0),
      modelsTotal: snap.providers.reduce((n, p) => n + p.models, 0),
      spentUsd: "0.00",
    },
    series: snap.series,
    stars,
    events,
  };
  if (owner) {
    data.topModels = [...snap.modelsHour]
      .sort((a, b) => b.requests - a.requests)
      .slice(0, TOP_MODELS)
      .map((m) => ({ provider: m.provider, model: m.model, requests: m.requests, successRate: ratio(m.ok, m.requests), p50LatencyMs: m.p50 }));
  }
  return data;
}

/** Cost-allowed, switched-on providers with their model counts (cached — latest_model_health is not free). */
async function loadProviders(): Promise<ProviderRow[]> {
  const cached = getCached<ProviderRow[]>("pulse:providers");
  if (cached) return cached;

  const sql = getSqlClient();
  const [toggles] = await Promise.all([getAllProviderToggles(), ensureApiKeysLoaded()]);
  const names = getCostAllowedProviders().filter((p) => isProviderCostAllowed(p) && toggles[p] !== false);
  const [models, labels] = await Promise.all([
    sql<{ provider: string; model_id: string; available: boolean }[]>`
      SELECT m.provider, m.model_id,
        (h.status IS NULL OR h.status = 'available' OR h.status = 'error')
          AND (h.cooldown_until IS NULL OR h.cooldown_until <= now()) AS available
      FROM models m
      LEFT JOIN latest_model_health h ON m.id = h.model_id
      WHERE m.provider = ANY(${names})
    `,
    sql<{ name: string; label: string | null }[]>`
      SELECT name, label FROM provider_catalog WHERE name = ANY(${names})
    `.catch(() => []),
  ]);

  const labelBy = new Map(labels.map((l) => [l.name, l.label]));
  const rows = names.map((provider) => {
    const own = models.filter((m) => m.provider === provider && isModelCostAllowed(provider, m.model_id));
    return {
      provider,
      label: labelBy.get(provider) || provider,
      hasKey: hasProviderKey(provider),
      models: own.length,
      available: own.filter((m) => m.available).length,
    };
  });
  setCache("pulse:providers", rows, PROVIDERS_CACHE_MS);
  return rows;
}

async function loadSnapshot(): Promise<PulseSnapshot> {
  const sql = getSqlClient();
  const [health, [hour], series, modelsHour, events, providers] = await Promise.all([
    getHealth(),
    sql<{ requests: number; ok: number; p50: number; today: number }[]>`
      SELECT
        count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS requests,
        count(*) FILTER (WHERE created_at > now() - interval '1 hour' AND status BETWEEN 200 AND 299)::int AS ok,
        COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)
          FILTER (WHERE created_at > now() - interval '1 hour'), 0)::int AS p50,
        count(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int AS today
      FROM gateway_logs
      WHERE created_at >= LEAST(date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', now() - interval '1 hour')
    `,
    sql<{ t: Date; requests: number; failures: number; p50: number }[]>`
      SELECT m.t,
        count(g.id)::int AS requests,
        count(g.id) FILTER (WHERE g.status NOT BETWEEN 200 AND 299)::int AS failures,
        COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY g.latency_ms), 0)::int AS p50
      FROM generate_series(date_trunc('minute', now()) - interval '59 minutes', date_trunc('minute', now()), interval '1 minute') AS m(t)
      LEFT JOIN gateway_logs g ON g.created_at >= m.t AND g.created_at < m.t + interval '1 minute'
      GROUP BY m.t
      ORDER BY m.t
    `,
    sql<ModelHourRow[]>`
      SELECT provider, COALESCE(resolved_model, request_model) AS model,
        count(*)::int AS requests,
        count(*) FILTER (WHERE status BETWEEN 200 AND 299)::int AS ok,
        COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms), 0)::int AS p50
      FROM gateway_logs
      WHERE created_at > now() - interval '1 hour' AND provider IS NOT NULL
      GROUP BY 1, 2
    `,
    // routing_explain may be stored as a JSON-encoded string — unwrap it before reading fields.
    sql<(Omit<EventRow, "route"> & { mode: string | null; category: string | null; reason: string | null; fallback_used: boolean | null; candidates: number | null })[]>`
      SELECT e.id::text AS id, e.created_at AS "createdAt", e.provider, e.request_model AS "requestModel",
        e.resolved_model AS model, e.status, e.latency_ms AS "latencyMs",
        e.input_tokens AS "tokensIn", e.output_tokens AS "tokensOut",
        r.x->>'mode' AS mode, r.x->>'category' AS category, r.x->'selected'->>'reason' AS reason,
        r.x->'fallbackUsed' = 'true'::jsonb AS fallback_used,
        CASE WHEN jsonb_typeof(r.x->'candidates') = 'array' THEN jsonb_array_length(r.x->'candidates') END AS candidates
      FROM (
        SELECT id, created_at, provider, request_model, resolved_model, status, latency_ms,
          input_tokens, output_tokens, routing_explain
        FROM gateway_logs
        WHERE created_at > now() - interval '15 minutes'
        ORDER BY created_at DESC, id DESC
        LIMIT 100
      ) e
      CROSS JOIN LATERAL (
        SELECT CASE WHEN jsonb_typeof(e.routing_explain) = 'string'
          THEN (e.routing_explain #>> '{}')::jsonb ELSE e.routing_explain END AS x
      ) r
      ORDER BY e.created_at, e.id
    `,
    loadProviders(),
  ]);

  return {
    health: health.body.status,
    hour: { requests: hour?.requests ?? 0, ok: hour?.ok ?? 0, p50: hour?.p50 ?? 0 },
    today: hour?.today ?? 0,
    series: series.map((m) => ({ t: m.t.toISOString(), requests: m.requests, failures: m.failures, p50LatencyMs: m.p50 })),
    providers,
    modelsHour: [...modelsHour],
    events: events.map(({ mode, category, reason, fallback_used, candidates, ...e }) => ({
      ...e,
      route: mode == null && category == null && reason == null && fallback_used == null && candidates == null
        ? null
        : {
            mode: mode ?? undefined,
            category: category ?? undefined,
            reason: reason ?? undefined,
            fallbackUsed: fallback_used ?? undefined,
            candidates: candidates ?? undefined,
          },
    })),
  };
}

/** ISO `since` within the event window, else undefined (ignored). */
export function parseSince(raw: string | null | undefined, now = Date.now()): number | undefined {
  if (!raw || raw.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(raw)) return undefined;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) && ms >= now - EVENT_WINDOW_MS ? ms : undefined;
}

/** Events strictly newer than `since` (an invalid/too-old `since` is ignored). */
export function filterSince(data: PulseData, since: string | null | undefined): PulseData {
  const sinceMs = parseSince(since);
  return sinceMs === undefined ? data : { ...data, events: data.events.filter((e) => Date.parse(e.t) > sinceMs) };
}

// One DB load per scope per CACHE_MS, shared by every poller (in-flight promise included).
const cache = new Map<PulseScope, { at: number; data: Promise<PulseData> }>();

export async function buildPulse(scope: PulseScope, since?: string | null): Promise<PulseData> {
  let entry = cache.get(scope);
  if (!entry || Date.now() - entry.at > CACHE_MS) {
    const fresh = { at: Date.now(), data: loadSnapshot().then((snap) => shapePulse(scope, snap)) };
    fresh.data.catch(() => {
      if (cache.get(scope) === fresh) cache.delete(scope);
    });
    cache.set(scope, fresh);
    entry = fresh;
  }
  return filterSince(await entry.data, since);
}
