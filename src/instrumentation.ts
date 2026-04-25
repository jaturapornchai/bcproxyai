/**
 * Next.js instrumentation hook — runs once per server boot on the Node runtime.
 * Used for: prewarm TLS, kick off worker cron, drain in-flight on shutdown.
 */
import { upstreamAgent } from "@/lib/upstream-agent";
import { startPrewarm } from "@/lib/prewarm";

export let shuttingDown = false;

function warnIfProductionAuthOpen(): void {
  const hasMasterKey = Boolean(process.env.GATEWAY_API_KEY?.trim());
  const hasOwner = Boolean(process.env.AUTH_OWNER_EMAIL?.trim());
  const hasAdminPassword = (process.env.ADMIN_PASSWORD?.trim().length ?? 0) >= 4;
  if (process.env.NODE_ENV === "production" && !hasMasterKey && !hasOwner && !hasAdminPassword) {
    console.warn(
      "[SECURITY] NODE_ENV=production but auth is disabled. Set GATEWAY_API_KEY, AUTH_OWNER_EMAIL, or ADMIN_PASSWORD.",
    );
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const DRAIN_TIMEOUT_MS = 15_000;

    warnIfProductionAuthOpen();

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

      // Hard exit fallback — runs even if any of the awaits below hangs.
      // unref() so this timer alone won't keep the process alive.
      const hardExit = setTimeout(() => {
        console.log(`[SHUTDOWN] Drain timeout reached — exiting`);
        process.exit(0);
      }, DRAIN_TIMEOUT_MS);
      hardExit.unref();

      try {
        // Stop scheduling new background work + release the Redis leader lock
        // so the next replica can pick up immediately instead of waiting 14min.
        try {
          const { stopWorker } = await import("@/lib/worker");
          await stopWorker();
        } catch (err) {
          console.warn("[SHUTDOWN] stopWorker failed:", err);
        }

        // Close upstream undici agent (drains keep-alive sockets cleanly)
        try { await upstreamAgent.close(); } catch { /* ignore */ }

        // Close the Postgres pool last so any in-flight INSERT/UPDATE from the
        // shutdown steps above completes before connections drop.
        try {
          const { getSqlClient } = await import("@/lib/db/schema");
          await getSqlClient().end({ timeout: 5 });
        } catch { /* ignore */ }
      } finally {
        clearTimeout(hardExit);
        // Clean exit — the unref'd timer above is also a safety net.
        process.exit(0);
      }
    };

    process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
    process.on("SIGINT", () => { void shutdown("SIGINT"); });
  }
}
