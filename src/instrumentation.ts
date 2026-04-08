/**
 * P3-2: Next.js instrumentation hook for graceful shutdown
 * Registers SIGTERM/SIGINT handlers to drain in-flight requests before exit.
 */
import { upstreamAgent } from "@/lib/upstream-agent";

export let shuttingDown = false;

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const DRAIN_TIMEOUT_MS = 15_000;

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
