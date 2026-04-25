/**
 * Next.js instrumentation hook — runs once per server boot on the Node runtime.
 * Used for: prewarm TLS, kick off worker cron, drain in-flight on shutdown.
 */
import { upstreamAgent } from "@/lib/upstream-agent";
import { startPrewarm } from "@/lib/prewarm";

export let shuttingDown = false;

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const DRAIN_TIMEOUT_MS = 15_000;

    // Warm TLS connections to the providers we route to most often, so the
    // first real chat request doesn't pay the ~30-100ms handshake cost.
    // Best-effort, errors swallowed.
    startPrewarm();

    // Kick off the worker cron (migration + heartbeat + cycles) on boot.
    // Defaults to on; set WORKER_AUTOSTART=0 to wait for the first /api/worker
    // ping instead (useful when running migrations from a one-shot job).
    if (process.env.WORKER_AUTOSTART !== "0") {
      try {
        const { ensureWorkerStarted } = await import("@/lib/worker/startup");
        ensureWorkerStarted();
      } catch (err) {
        console.error("[INSTRUMENT] worker autostart failed:", err);
      }
    }

    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`[SHUTDOWN] Received ${signal} — draining requests (max ${DRAIN_TIMEOUT_MS / 1000}s)...`);
      try {
        await upstreamAgent.close();
      } catch { /* ignore */ }
      setTimeout(() => {
        console.log(`[SHUTDOWN] Drain timeout reached — exiting`);
        process.exit(0);
      }, DRAIN_TIMEOUT_MS).unref();
    };

    process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
    process.on("SIGINT", () => { void shutdown("SIGINT"); });
  }
}
