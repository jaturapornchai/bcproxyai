import { startWorker } from "./index";
import { runMigrations } from "@/lib/db/migrate";
import { startHeartbeat } from "@/lib/heartbeat";

let started = false;

export function ensureWorkerStarted(): void {
  if (started) return;
  started = true;
  // Start heartbeat immediately so replica is visible in Redis
  startHeartbeat();
  // Run migrations then start worker
  runMigrations()
    .then(() => startWorker())
    .catch((err) => {
      console.error("[startup] Migration or worker start failed:", err);
      // Still try to start worker even if migration check failed
      startWorker();
    });
}
