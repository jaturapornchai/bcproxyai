// Shared contract for slow-cadence aggregates (server cache 25s, client polls every 30s while the tab is visible).
//   GET /api/public/insights → InsightsData with scope "public" (anonymized, no auth)
//   GET /api/insights        → InsightsData with scope "owner"  (owner Google session only)
// Fields marked "owner only" MUST be absent (not empty, not null) in public responses.
// Built from DB + Redis reads only: never calls a provider, never GET /api/worker (it starts the worker).
// Time boundaries match PulseData: "today" = since 00:00 UTC, "hour" = last 60 minutes.
import type { PerfEvent } from "./perf-counters";

/** Fixed radar order. Public exam arrays are positional (index = this list), so subject keys such as "thai" never appear in public JSON. */
export const EXAM_SUBJECTS = ["thai", "math", "json", "instruction", "classification", "safety"] as const;
export type ExamSubject = (typeof EXAM_SUBJECTS)[number];

export interface InsightsHour {
  /** ISO start of the hour bucket; 24 buckets oldest first, the last one is the current (partial) hour */
  t: string;
  requests: number;
  /** status NOT BETWEEN 200 AND 299 */
  failures: number;
  /** 0 when the hour had no traffic */
  p50LatencyMs: number;
  /** events with severity warn|error in this hour, capped at 9 (UI shows "9+"); no type, title or provider */
  incidents: number;
}

/** owner only (whole type): one row of the events table */
export interface InsightsIncident {
  /** ISO created_at */
  t: string;
  /** events.type, e.g. "provider_error" | "complaint" | "model_banned" | "thai_quality_fail" */
  type: string;
  severity: "warn" | "error";
  /** events.title; contains provider/model names. events.detail (upstream error text) is never sent. */
  title: string;
  /** events.provider = owner PulseStar.id; null when the event has none */
  provider: string | null;
}

export interface InsightsWorker {
  /** worker_state.status: "idle" | "running" | "error"; "unknown" when the row is missing */
  status: string;
  /** worker_state.last_run (ISO) */
  lastRun: string | null;
  /** worker_state.next_run (ISO, cycle start + 15 min); may be in the past when the worker is stopped → UI shows "เกินกำหนด" */
  nextRun: string | null;
  /** owner only: worker_state.last_stats (null when missing or unparsable) */
  lastCycle?: {
    scan: { found: number; new: number };
    health: { checked: number; available: number; cooldown: number };
    exam: { examined: number; passed: number; failed: number };
  } | null;
}

export interface InsightsExam {
  /** per EXAM_SUBJECTS index: mean score_pct (0..100, 1 decimal) of the 5 best models; 0 when no scores */
  top5: number[];
  /** per EXAM_SUBJECTS index: models with score_pct >= 50 */
  passing: number[];
  /** exam_attempts started in the last 24h; running = unfinished and started within the last 30 min */
  attempts24h: { passed: number; failed: number; running: number };
  /** owner only: best model per EXAM_SUBJECTS index, null when the subject has no scores */
  leaders?: ({ provider: string; model: string; scorePct: number } | null)[];
  /** owner only: worker_state.exam_level ("primary" | "middle" | "high" | "university") */
  level?: string | null;
  /** owner only: worker_state.judge_model */
  judgeModel?: string | null;
}

/** owner only (whole type): provider_limits rolled up per provider (rows updated in the last 24h) */
export interface InsightsLimit {
  /** = owner PulseStar.id */
  provider: string;
  /** 0..1, min remaining/limit across the provider's models; null when unknown or the reset already passed (treat as full) */
  tpmLeft: number | null;
  /** 0..1, same rule as tpmLeft for the daily window */
  tpdLeft: number | null;
  /** soonest future reset_tpm_at / reset_tpd_at (ISO) */
  nextReset: string | null;
  /** max last_429_at (ISO) */
  last429: string | null;
  models: number;
}

/** owner only (whole type): a model whose latest health row is still cooling down */
export interface InsightsCooldown {
  provider: string;
  model: string;
  /** latest_model_health.status */
  status: string;
  /** cooldown_until (ISO, future) */
  until: string;
  /** health error, at most 120 chars */
  error: string | null;
}

/** owner only (whole type): gateway_logs failures in the last 60 minutes */
export interface InsightsErrors {
  /** 429 → rateLimited, 5xx → server, 0 → timeout, other 4xx → client */
  classes: { rateLimited: number; server: number; client: number; timeout: number };
  /** newest first, at most 8 */
  recent: { t: string; provider: string | null; model: string; status: number; /** at most 140 chars */ error: string | null }[];
}

export interface InsightsData {
  scope: "public" | "owner";
  /** server clock when this response was shaped (the data itself may be up to 25s old) — use it for clock-skew correction */
  generatedAt: string;
  kpi: {
    /** p95 latency over the last hour, all providers; 0 without traffic */
    p95LatencyMs: number;
    /** owner only: last hour, 2xx answers whose routing fell back to another candidate (routing_explain.fallbackUsed).
     *  Not public: with sparse traffic, diffing it against the public pulse reveals a single request's fallback. */
    selfHealed?: number;
    /** input+output tokens since 00:00 UTC. Owner: exact. Public: floored to a 100K grid, null below 100K
     *  (per-request tokens are owner only; a finer rounding can be diffed back to one request). */
    tokensToday: number | null;
  };
  /** 24 hourly buckets, oldest first */
  day: InsightsHour[];
  worker: InsightsWorker;
  fleet: {
    /** getHealth().checks.minServingModels: exam-passed (score ≥ 50) and not cooling down */
    serving: number;
    /** models of the providers shown as stars whose latest health row is in cooldown */
    cooling: number;
    /** model_new events in the last 24h */
    newModels24h: number;
  };
  exam: InsightsExam;
  /** owner only: warn|error events of the last 24h, newest first, at most 20 */
  incidents?: InsightsIncident[];
  /** owner only: subsystem checks from getHealth() (alerts may hold internal error text) */
  systems?: {
    database: { ok: boolean; latencyMs: number };
    redis: { ok: boolean };
    alerts: string[];
  };
  /** owner only: Redis perf:* counters (getPerfCounts); fixed 1h TTL window from the first bump → label "~1 ชม." */
  perf?: Record<PerfEvent, number>;
  /** owner only: worst headroom first */
  limits?: InsightsLimit[];
  /** owner only: soonest-recovering first */
  cooldowns?: { total: number; items: InsightsCooldown[] };
  /** owner only */
  errors?: InsightsErrors;
}
