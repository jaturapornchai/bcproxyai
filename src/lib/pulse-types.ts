// Shared contract for live activity data.
//   GET /api/public/pulse → PulseData with scope "public" (anonymized, no auth)
//   GET /api/activity     → PulseData with scope "owner"  (owner Google session only)
// Fields marked "owner only" MUST be absent (not empty, not null) in public responses.

export type ProviderStatus = "up" | "degraded" | "down" | "nokey";

export interface PulseStar {
  /** public: daily-rotating HMAC id (e.g. "s7f3a2"); owner: real provider name (e.g. "groq") */
  id: string;
  /** owner only: display name */
  label?: string;
  status: ProviderStatus;
  /** owner only: per-provider counts are near-fixed (and published in the README), so they would fingerprint a public star */
  models?: number;
  /** owner only */
  available?: number;
  /** requests routed to this provider in the last 60 minutes */
  load: number;
}

export interface PulseRoute {
  mode?: string;
  category?: string;
  reason?: string;
  fallbackUsed?: boolean;
  candidates?: number;
}

export interface PulseEvent {
  /** public: opaque per-event id (HMAC); owner: gateway_logs.id as string */
  id: string;
  /** ISO timestamp of the request */
  t: string;
  /** PulseStar.id of the provider that served (or failed) it; "" when routing found no provider */
  star: string;
  ok: boolean;
  latencyMs: number;
  /** owner only */
  model?: string;
  /** owner only */
  requestModel?: string;
  /** owner only: HTTP status */
  status?: number;
  /** owner only */
  tokensIn?: number;
  /** owner only */
  tokensOut?: number;
  /** owner only: routing decision summary (never prompt text) */
  route?: PulseRoute;
}

export interface PulseMinute {
  /** ISO minute bucket */
  t: string;
  requests: number;
  failures: number;
  p50LatencyMs: number;
}

export interface PulseTopModel {
  provider: string;
  model: string;
  requests: number;
  /** 0..1 */
  successRate: number;
  p50LatencyMs: number;
}

export interface PulseData {
  scope: "public" | "owner";
  generatedAt: string;
  status: "ok" | "degraded" | "down";
  stats: {
    requestsLastHour: number;
    requestsToday: number;
    /** 0..1 over the last hour; 1 when there was no traffic */
    successRate: number;
    p50LatencyMs: number;
    providersUp: number;
    providersTotal: number;
    modelsAvailable: number;
    modelsTotal: number;
    /** always the decimal string "0.00": the free-only policy ceiling, NOT measured spend (real OpenRouter usage is owner-only, GET /api/openrouter-status) */
    spentUsd: string;
  };
  /** last 60 one-minute buckets, oldest first */
  series: PulseMinute[];
  stars: PulseStar[];
  /** newest last; at most 100; only events after ?since=<ISO> when given */
  events: PulseEvent[];
  /** owner only */
  topModels?: PulseTopModel[];
}
