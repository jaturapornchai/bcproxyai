import { isProviderCostAllowed } from "@/lib/cost-policy";

/**
 * Connection pre-warm — fires HEAD/OPTIONS requests to the providers we route
 * to most often, so the TCP+TLS handshake is amortized before the first real
 * `/v1/chat/completions` arrives. Saves ~30-100ms per cold call.
 *
 * Designed to be cheap + best-effort:
 *   • runs once on process boot from instrumentation.ts
 *   • requests time out after 4s
 *   • errors swallowed (provider down doesn't block startup)
 *   • re-runs every 4 minutes to keep keep-alive sockets warm
 */
const PREWARM_TARGETS = [
  // Fast OpenAI-compatible providers we route through most
  { provider: "groq", url: "https://api.groq.com/openai/v1/models" },
  { provider: "cerebras", url: "https://api.cerebras.ai/v1/models" },
  { provider: "sambanova", url: "https://api.sambanova.ai/v1/models" },
  { provider: "google", url: "https://generativelanguage.googleapis.com/v1beta/models" },
  { provider: "openrouter", url: "https://openrouter.ai/api/v1/models" },
  { provider: "thaillm", url: "https://api.thaillm.or.th/v1/models" },
  { provider: "typhoon", url: "https://api.opentyphoon.ai/v1/models" },
  { provider: "mistral", url: "https://api.mistral.ai/v1/models" },
  { provider: "pollinations", url: "https://text.pollinations.ai/models" },
];

const PREWARM_TIMEOUT_MS = 4_000;
const PREWARM_INTERVAL_MS = 4 * 60 * 1000;

async function ping(url: string): Promise<void> {
  try {
    await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(PREWARM_TIMEOUT_MS),
    });
  } catch { /* ignore — best-effort */ }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startPrewarm(): void {
  if (timer) return; // already running
  const targets = PREWARM_TARGETS
    .filter((target) => isProviderCostAllowed(target.provider))
    .map((target) => target.url);
  if (targets.length === 0) return;

  // Fire immediately on boot
  void Promise.allSettled(targets.map(ping));

  // Keep sockets warm — Node's HTTPS agent garbage-collects idle sockets
  // after ~30-60s, so re-pinging every 4 min keeps the pool hot.
  timer = setInterval(() => {
    void Promise.allSettled(targets.map(ping));
  }, PREWARM_INTERVAL_MS);
  // Don't keep the process alive just for this
  timer.unref?.();
}
