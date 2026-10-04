/**
 * Slow-cadence control-center aggregates (contract: src/lib/insights-types.ts).
 *
 *   buildInsights(scope) → InsightsData
 *
 * One DB/Redis load per 30s shared by both scopes (in-flight promise included), then pure scope shaping.
 * Every sub-query falls back to zero/empty on failure, so a missing table only blanks its own window.
 * Reads only — never calls a provider and never touches /api/worker. The public scope is built from a
 * whitelist: no provider/model names, error text, ids or event titles.
 */
import { getSqlClient } from "@/lib/db/schema";
import { getCostAllowedProviders, isProviderCostAllowed } from "@/lib/cost-policy";
import { getAllProviderToggles } from "@/lib/provider-toggle";
import { getPerfCounts, type PerfEvent } from "@/lib/perf-counters";
import { getHealth } from "@/lib/pulse";
import {
  EXAM_SUBJECTS,
  type InsightsData,
  type InsightsErrors,
  type InsightsExam,
  type InsightsHour,
  type InsightsIncident,
  type InsightsLimit,
  type InsightsWorker,
} from "@/lib/insights-types";

export type InsightsScope = InsightsData["scope"];

/** Everything buildInsights reads, before scope shaping (owner-complete). */
export interface InsightsSnapshot {
  kpi: { p95LatencyMs: number; selfHealed: number; tokensToday: number };
  day: InsightsHour[];
  worker: Required<InsightsWorker>;
  fleet: InsightsData["fleet"];
  exam: Required<InsightsExam>;
  incidents: InsightsIncident[];
  systems: NonNullable<InsightsData["systems"]>;
  perf: Record<PerfEvent, number>;
  limits: InsightsLimit[];
  cooldowns: NonNullable<InsightsData["cooldowns"]>;
  errors: InsightsErrors;
}

/** a little under the 30 s client poll, so every poll gets a fresh load */
const CACHE_MS = 25_000;
/** a load where some sub-query failed is retried soon instead of serving its zeros for a full cycle */
const RETRY_MS = 5_000;
/** public tokensToday grid: coarser than any single request, so differencing two snapshots never reveals one */
const TOKEN_GRID = 100_000;
const WORKER_STATUSES = new Set(["idle", "running", "error"]);
const SUBJECTS: string[] = [...EXAM_SUBJECTS];

const iso = (v: Date | string | null | undefined): string | null => {
  if (v == null) return null;
  const ms = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const share = (v: number | null) => (v == null ? null : Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000);

/** 24 zero buckets ending at the current hour (filled from the hourly query). */
function emptyDay(now: Date): InsightsHour[] {
  const hour = Math.floor(now.getTime() / 3_600_000) * 3_600_000;
  return Array.from({ length: 24 }, (_, i) => ({
    t: new Date(hour - (23 - i) * 3_600_000).toISOString(),
    requests: 0,
    failures: 0,
    p50LatencyMs: 0,
    incidents: 0,
  }));
}

/** worker_state.last_stats → the listed numeric fields only; null when missing or unparsable. */
export function parseLastCycle(raw: string | null | undefined): NonNullable<InsightsWorker["lastCycle"]> | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (!s || typeof s !== "object") return null;
    return {
      scan: { found: num(s.scan?.found), new: num(s.scan?.new) },
      health: { checked: num(s.health?.checked), available: num(s.health?.available), cooldown: num(s.health?.cooldown) },
      exam: { examined: num(s.exam?.examined), passed: num(s.exam?.passed), failed: num(s.exam?.failed) },
    };
  } catch {
    return null;
  }
}

/** floor to TOKEN_GRID; null below one grid step (the first requests of the day would otherwise be exact) */
export const publicTokens = (n: number): number | null => (n < TOKEN_GRID ? null : Math.floor(n / TOKEN_GRID) * TOKEN_GRID);

/** Pure scope shaping. Public output is a whitelist; owner-only keys are absent, not empty. */
export function shapeInsights(scope: InsightsScope, snap: InsightsSnapshot, now = new Date()): InsightsData {
  const { kpi, worker, exam } = snap;
  const owner = scope === "owner";
  const data: InsightsData = {
    scope,
    generatedAt: now.toISOString(), // response time, not load time: the UI corrects clock skew with it
    // selfHealed is owner only: diffed against the public pulse it would reveal one request's fallback
    kpi: {
      p95LatencyMs: kpi.p95LatencyMs,
      tokensToday: owner ? kpi.tokensToday : publicTokens(kpi.tokensToday),
    },
    day: snap.day.map((h) => ({ t: h.t, requests: h.requests, failures: h.failures, p50LatencyMs: h.p50LatencyMs, incidents: h.incidents })),
    worker: {
      status: WORKER_STATUSES.has(worker.status) ? worker.status : "unknown",
      lastRun: worker.lastRun,
      nextRun: worker.nextRun,
    },
    fleet: { serving: snap.fleet.serving, cooling: snap.fleet.cooling, newModels24h: snap.fleet.newModels24h },
    exam: { top5: exam.top5, passing: exam.passing, attempts24h: exam.attempts24h },
  };
  if (!owner) return data;
  return {
    ...data,
    kpi: { ...data.kpi, selfHealed: kpi.selfHealed },
    worker: { ...data.worker, lastCycle: worker.lastCycle },
    exam: { ...data.exam, leaders: exam.leaders, level: exam.level, judgeModel: exam.judgeModel },
    incidents: snap.incidents,
    systems: snap.systems,
    perf: snap.perf,
    limits: snap.limits,
    cooldowns: snap.cooldowns,
    errors: snap.errors,
  };
}

/** Same provider set as the pulse stars: cost-allowed and switched on. */
async function allowedProviders(): Promise<string[]> {
  const toggles = await getAllProviderToggles();
  return getCostAllowedProviders().filter((p) => isProviderCostAllowed(p) && toggles[p] !== false);
}

async function readSnapshot(): Promise<{ snap: InsightsSnapshot; partial: boolean }> {
  const sql = getSqlClient();
  const now = new Date();
  let partial = false;
  const soft = <T,>(q: Promise<T[]>): Promise<T[]> => q.catch(() => ((partial = true), [] as T[]));
  const names = allowedProviders().catch(() => ((partial = true), [] as string[]));

  const [gw, hours, eventHours, incidents, workerRows, health, cooldownRows, examRows, [attempts], perf, limitRows, recentErrors] = await Promise.all([
    // KPI + error classes: one range scan over max(today, last hour).
    soft(sql<{ p95: number; healed: number; tokens: string; rl: number; server: number; client: number; timeout: number }[]>`
      SELECT
        COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY g.latency_ms)
          FILTER (WHERE g.created_at > now() - interval '1 hour'), 0)::int AS p95,
        count(*) FILTER (WHERE g.created_at > now() - interval '1 hour' AND g.status BETWEEN 200 AND 299
          AND g.routing_explain IS NOT NULL
          AND (CASE WHEN jsonb_typeof(g.routing_explain) = 'string'
                 THEN (g.routing_explain #>> '{}')::jsonb ELSE g.routing_explain END)->'fallbackUsed' = 'true'::jsonb)::int AS healed,
        COALESCE(sum(g.input_tokens + g.output_tokens) FILTER (WHERE g.created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0)::bigint AS tokens,
        count(*) FILTER (WHERE g.created_at > now() - interval '1 hour' AND g.status = 429)::int AS rl,
        count(*) FILTER (WHERE g.created_at > now() - interval '1 hour' AND g.status >= 500)::int AS server,
        count(*) FILTER (WHERE g.created_at > now() - interval '1 hour' AND g.status >= 400 AND g.status < 500 AND g.status <> 429)::int AS client,
        count(*) FILTER (WHERE g.created_at > now() - interval '1 hour' AND g.status = 0)::int AS timeout
      FROM gateway_logs g
      WHERE g.created_at >= LEAST(date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', now() - interval '1 hour')
    `),
    // One pass grouped by hour; empty hours are zero-filled in JS (emptyDay).
    soft(sql<{ t: Date; requests: number; failures: number; p50: number }[]>`
      SELECT date_trunc('hour', created_at) AS t,
        count(*)::int AS requests,
        count(*) FILTER (WHERE status NOT BETWEEN 200 AND 299)::int AS failures,
        COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms), 0)::int AS p50
      FROM gateway_logs
      WHERE created_at >= date_trunc('hour', now()) - interval '23 hours'
      GROUP BY 1
    `),
    // Per-hour incident counts + new models; buckets older than the day window are dropped in the merge.
    soft(sql<{ t: Date; incidents: number; created: number }[]>`
      SELECT date_trunc('hour', created_at) AS t,
        count(*) FILTER (WHERE severity IN ('warn', 'error'))::int AS incidents,
        count(*) FILTER (WHERE type = 'model_new')::int AS created
      FROM events
      WHERE created_at > now() - interval '24 hours'
      GROUP BY 1
    `),
    soft(sql<{ t: Date; type: string; severity: "warn" | "error"; title: string; provider: string | null }[]>`
      SELECT created_at AS t, type, severity, title, provider
      FROM events
      WHERE created_at > now() - interval '24 hours' AND severity IN ('warn', 'error')
      ORDER BY created_at DESC, id DESC
      LIMIT 20
    `),
    // Explicit key list: worker_state also holds keys that must never leave the server.
    soft(sql<{ key: string; value: string }[]>`
      SELECT key, value FROM worker_state
      WHERE key IN ('status', 'last_run', 'next_run', 'last_stats', 'exam_level', 'judge_model')
    `),
    getHealth(),
    soft(names.then((n) => sql<{ provider: string; model: string; status: string; until: Date; error: string | null; total: number }[]>`
      SELECT m.provider, m.model_id AS model, h.status, h.cooldown_until AS until, left(h.error, 120) AS error,
        count(*) OVER ()::int AS total
      FROM latest_model_health h
      JOIN models m ON m.id = h.model_id
      WHERE m.provider = ANY(${n}) AND h.cooldown_until > now()
      ORDER BY h.cooldown_until
      LIMIT 12
    `)),
    soft(names.then((n) => sql<{ category: string; top5: number | null; passing: number; leader_provider: string | null; leader_model: string | null; leader_score: number | null }[]>`
      SELECT category,
        round(avg(score_pct) FILTER (WHERE rn <= 5)::numeric, 1)::float8 AS top5,
        count(*) FILTER (WHERE score_pct >= 50)::int AS passing,
        (array_agg(provider) FILTER (WHERE rn = 1))[1] AS leader_provider,
        (array_agg(model_id) FILTER (WHERE rn = 1))[1] AS leader_model,
        round(max(score_pct) FILTER (WHERE rn = 1)::numeric, 1)::float8 AS leader_score
      FROM (
        SELECT s.category, s.score_pct, m.provider, m.model_id,
          row_number() OVER (PARTITION BY s.category ORDER BY s.score_pct DESC, s.model_id) AS rn
        FROM model_category_scores s
        JOIN models m ON m.id = s.model_id
        WHERE s.category = ANY(${SUBJECTS}) AND m.provider = ANY(${n})
      ) ranked
      GROUP BY category
    `)),
    soft(sql<{ passed: number; failed: number; running: number }[]>`
      SELECT
        count(*) FILTER (WHERE finished_at IS NOT NULL AND passed)::int AS passed,
        count(*) FILTER (WHERE finished_at IS NOT NULL AND NOT passed)::int AS failed,
        count(*) FILTER (WHERE finished_at IS NULL AND started_at > now() - interval '30 minutes')::int AS running
      FROM exam_attempts
      WHERE started_at > now() - interval '24 hours'
    `),
    getPerfCounts(),
    // A window counts only while its reset is ahead (or, without a reset time, while the row is fresh).
    soft(names.then((n) => sql<{ provider: string; tpm: number | null; tpd: number | null; next_reset: Date | null; last429: Date | null; models: number }[]>`
      SELECT provider,
        min(remaining_tpm::float8 / NULLIF(limit_tpm, 0)) FILTER (WHERE remaining_tpm IS NOT NULL AND limit_tpm > 0
          AND (reset_tpm_at > now() OR (reset_tpm_at IS NULL AND updated_at > now() - interval '2 minutes'))) AS tpm,
        min(remaining_tpd::float8 / NULLIF(limit_tpd, 0)) FILTER (WHERE remaining_tpd IS NOT NULL AND limit_tpd > 0
          AND (reset_tpd_at > now() OR (reset_tpd_at IS NULL AND updated_at > now() - interval '10 minutes'))) AS tpd,
        LEAST(min(reset_tpm_at) FILTER (WHERE reset_tpm_at > now()), min(reset_tpd_at) FILTER (WHERE reset_tpd_at > now())) AS next_reset,
        max(last_429_at) AS last429,
        count(*)::int AS models
      FROM provider_limits
      WHERE updated_at > now() - interval '24 hours' AND provider = ANY(${n})
      GROUP BY provider
    `)),
    soft(sql<{ t: Date; provider: string | null; model: string; status: number; error: string | null }[]>`
      SELECT created_at AS t, provider, COALESCE(resolved_model, request_model) AS model, status, left(error, 140) AS error
      FROM gateway_logs
      WHERE created_at > now() - interval '1 hour' AND (status >= 400 OR status = 0)
      ORDER BY created_at DESC, id DESC
      LIMIT 8
    `),
  ]);

  const k = gw[0];
  // ponytail: buckets keyed by instant — assumes a whole-hour DB session time zone (UTC / Asia/Bangkok)
  const hourAt = new Map(hours.map((h) => [h.t.getTime(), h]));
  const incidentsAt = new Map(eventHours.map((e) => [e.t.getTime(), e.incidents]));
  const day = emptyDay(now);
  for (const b of day) {
    const at = Date.parse(b.t);
    const h = hourAt.get(at);
    if (h) Object.assign(b, { requests: h.requests, failures: h.failures, p50LatencyMs: h.p50 });
    b.incidents = Math.min(incidentsAt.get(at) ?? 0, 9);
  }

  const state = new Map(workerRows.map((r) => [r.key, r.value]));
  const bySubject = new Map(examRows.map((r) => [r.category, r]));
  const subjects = SUBJECTS.map((s) => bySubject.get(s));
  const { checks, alerts } = health.body;

  const snap: InsightsSnapshot = {
    kpi: { p95LatencyMs: k?.p95 ?? 0, selfHealed: k?.healed ?? 0, tokensToday: num(k?.tokens) },
    day,
    worker: {
      status: state.get("status") ?? "unknown",
      lastRun: iso(state.get("last_run")),
      nextRun: iso(state.get("next_run")),
      lastCycle: parseLastCycle(state.get("last_stats")),
    },
    fleet: {
      serving: checks.minServingModels,
      cooling: cooldownRows[0]?.total ?? 0,
      newModels24h: eventHours.reduce((n, e) => n + e.created, 0),
    },
    exam: {
      top5: subjects.map((r) => r?.top5 ?? 0),
      passing: subjects.map((r) => r?.passing ?? 0),
      attempts24h: { passed: attempts?.passed ?? 0, failed: attempts?.failed ?? 0, running: attempts?.running ?? 0 },
      leaders: subjects.map((r) =>
        r?.leader_provider && r.leader_model ? { provider: r.leader_provider, model: r.leader_model, scorePct: r.leader_score ?? 0 } : null,
      ),
      level: state.get("exam_level") ?? null,
      judgeModel: state.get("judge_model") ?? null,
    },
    incidents: incidents.map((e) => ({ t: e.t.toISOString(), type: e.type, severity: e.severity, title: e.title, provider: e.provider })),
    systems: { database: checks.database, redis: checks.redis, alerts },
    perf,
    limits: limitRows
      .map((r) => ({ provider: r.provider, tpmLeft: share(r.tpm), tpdLeft: share(r.tpd), nextReset: iso(r.next_reset), last429: iso(r.last429), models: r.models }))
      .sort((a, b) => Math.min(a.tpmLeft ?? 1, a.tpdLeft ?? 1) - Math.min(b.tpmLeft ?? 1, b.tpdLeft ?? 1) || a.provider.localeCompare(b.provider)),
    cooldowns: {
      total: cooldownRows[0]?.total ?? 0,
      items: cooldownRows.map((r) => ({ provider: r.provider, model: r.model, status: r.status, until: r.until.toISOString(), error: r.error })),
    },
    errors: {
      classes: { rateLimited: k?.rl ?? 0, server: k?.server ?? 0, client: k?.client ?? 0, timeout: k?.timeout ?? 0 },
      recent: recentErrors.map((e) => ({ t: e.t.toISOString(), provider: e.provider, model: e.model, status: e.status, error: e.error })),
    },
  };
  return { snap, partial };
}

// One load per CACHE_MS for both scopes, shared by every poller (in-flight promise included).
// A load with a failed sub-query lives only RETRY_MS, so a transient DB error does not pose as "no traffic" for a full cycle.
let snapshot: { at: number; ttl: number; data: Promise<InsightsSnapshot> } | null = null;

function loadInsightsSnapshot(): Promise<InsightsSnapshot> {
  if (!snapshot || Date.now() - snapshot.at >= snapshot.ttl) {
    const fresh: NonNullable<typeof snapshot> = {
      at: Date.now(),
      ttl: CACHE_MS,
      data: readSnapshot().then(({ snap, partial }) => {
        if (partial) fresh.ttl = RETRY_MS;
        return snap;
      }),
    };
    fresh.data.catch(() => {
      if (snapshot === fresh) snapshot = null;
    });
    snapshot = fresh;
  }
  return snapshot.data;
}

export async function buildInsights(scope: InsightsScope): Promise<InsightsData> {
  return shapeInsights(scope, await loadInsightsSnapshot());
}
