/**
 * Smart Routing Explain — decision trail captured per /v1/chat/completions
 * request and persisted to gateway_logs.routing_explain (JSONB).
 *
 * Stores ONLY routing metadata (provider, model, reason). Never include
 * prompt text, message content, headers, or anything that could leak PII.
 */

export type RoutingReasonCode =
  // Selected
  | "selected:cheapest"
  | "selected:fastest"
  | "selected:healthy"
  | "selected:fallback"
  | "selected:cache-hit"
  | "selected:sticky"
  | "selected:learned-best"
  | "selected:requested"
  // Rejected
  | "rejected:cooldown"
  | "rejected:high-error-rate"
  | "rejected:disabled"
  | "rejected:quota"
  | "rejected:tpm-exhausted"
  | "rejected:circuit-open"
  | "rejected:no-key"
  | "rejected:context-too-small"
  | "rejected:capability-missing"
  | "rejected:upstream-error"
  | "rejected:slow"
  | "rejected:other";

export interface RoutingCandidate {
  provider: string;
  model: string;
  accepted: boolean;
  reason: RoutingReasonCode;
  /** optional small detail — e.g. "errorRate=0.42", "tpm:18230/20000" */
  detail?: string;
}

export interface RoutingExplain {
  mode: string;
  category: string | null;
  candidates: RoutingCandidate[];
  selected: { provider: string; model: string; reason: RoutingReasonCode } | null;
  fallbackUsed: boolean;
}

export function emptyExplain(mode: string, category: string | null = null): RoutingExplain {
  return { mode, category, candidates: [], selected: null, fallbackUsed: false };
}

export function recordCandidate(
  explain: RoutingExplain,
  provider: string,
  model: string,
  accepted: boolean,
  reason: RoutingReasonCode,
  detail?: string,
): void {
  // Hard cap so a degenerate routing path doesn't blow up the JSONB column.
  if (explain.candidates.length >= 50) return;
  explain.candidates.push({ provider, model, accepted, reason, detail });
}

export function recordSelection(
  explain: RoutingExplain,
  provider: string,
  model: string,
  reason: RoutingReasonCode,
): void {
  explain.selected = { provider, model, reason };
}

// ─── Per-request stash ───
// Routing decisions are made deep inside selectModelsByMode / forwardToProvider
// loops; the actual logGateway call may happen many lines later. Rather than
// thread a parameter through every call site we keep a short-lived map keyed
// by request id and let logGateway pull the explain at flush time.
//
// Bounded: entries are removed when consumed; a sweeper drops anything older
// than 5 minutes so abandoned requests can't leak.

interface StashEntry {
  explain: RoutingExplain;
  at: number;
}

const STASH_TTL_MS = 5 * 60 * 1000;
const _stash = new Map<string, StashEntry>();
let _sweepTimer: ReturnType<typeof setInterval> | null = null;

function ensureSweeper(): void {
  if (_sweepTimer) return;
  _sweepTimer = setInterval(() => {
    const cutoff = Date.now() - STASH_TTL_MS;
    for (const [key, entry] of _stash.entries()) {
      if (entry.at < cutoff) _stash.delete(key);
    }
  }, 60_000);
  if (typeof _sweepTimer.unref === "function") _sweepTimer.unref();
}

export function stashExplain(requestId: string | null | undefined, explain: RoutingExplain): void {
  if (!requestId) return;
  ensureSweeper();
  _stash.set(requestId, { explain, at: Date.now() });
}

export function consumeExplain(requestId: string | null | undefined): RoutingExplain | null {
  if (!requestId) return null;
  const entry = _stash.get(requestId);
  if (!entry) return null;
  _stash.delete(requestId);
  return entry.explain;
}

/**
 * Mark a stashed explain's winner without consuming it. Call this from the
 * success path right before logGateway() runs; logGateway() then drains the
 * stash and writes the final explain into gateway_logs.routing_explain.
 */
export function markWinner(
  requestId: string | null | undefined,
  provider: string,
  model: string,
  reason: RoutingReasonCode = "selected:healthy",
): void {
  if (!requestId) return;
  const entry = _stash.get(requestId);
  if (!entry) return;
  recordSelection(entry.explain, provider, model, reason);
  for (const c of entry.explain.candidates) {
    if (c.provider === provider && c.model === model) {
      c.accepted = true;
      c.reason = reason;
    }
  }
  entry.at = Date.now();
}

