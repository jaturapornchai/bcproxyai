import { getSqlClient } from "@/lib/db/schema";
import { scanModels } from "./scanner";
import { checkHealth } from "./health";
import { runExams } from "./exam";
import { appointTeachers } from "@/lib/teacher";
import { acquireLeader, renewLeader, releaseLeader } from "./leader";
import { startWarmup, stopWarmup } from "./warmup";

export { scanModels } from "./scanner";
export { checkHealth } from "./health";
export { runExams } from "./exam";

export interface WorkerStatus {
  status: "idle" | "running" | "error";
  lastRun: string | null;
  nextRun: string | null;
  stats: {
    scan?: { found: number; new: number };
    health?: { checked: number; available: number; cooldown: number };
    exam?: { examined: number; passed: number; failed: number };
  };
}

let workerTimer: ReturnType<typeof setInterval> | null = null;
let examTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let examRunning = false;

async function getState(key: string): Promise<string | null> {
  try {
    const sql = getSqlClient();
    const rows = await sql<{ value: string }[]>`
      SELECT value FROM worker_state WHERE key = ${key}
    `;
    return rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

async function setState(key: string, value: string): Promise<void> {
  try {
    const sql = getSqlClient();
    await sql`
      INSERT INTO worker_state (key, value) VALUES (${key}, ${value})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `;
  } catch {
    // silent
  }
}

async function logWorker(step: string, message: string, level = "info"): Promise<void> {
  try {
    const sql = getSqlClient();
    await sql`
      INSERT INTO worker_logs (step, message, level) VALUES (${step}, ${message}, ${level})
    `;
  } catch {
    // silent
  }
}

async function cleanOldLogs(): Promise<void> {
  try {
    const sql = getSqlClient();
    const workerResult = await sql`DELETE FROM worker_logs WHERE created_at < now() - interval '3 days'`;
    const healthResult = await sql`DELETE FROM health_logs WHERE checked_at < now() - interval '3 days'`;
    const gatewayResult = await sql`DELETE FROM gateway_logs WHERE created_at < now() - interval '7 days'`;
    await logWorker(
      "cleanup",
      `🧹 ลบ log เก่า: worker ${workerResult.count}, health ${healthResult.count}, gateway ${gatewayResult.count} แถว`
    );
  } catch (err) {
    await logWorker("cleanup", `Log cleanup failed: ${err}`, "error");
  }
}

export async function runWorkerCycle(): Promise<void> {
  if (isRunning) {
    await logWorker("worker", "Cycle skipped — already running", "warn");
    return;
  }

  // Leader election — only one replica runs the cycle when scaled horizontally.
  // Falls through to "true" if Redis is unreachable (single-replica dev setup).
  const isLeader = await acquireLeader();
  if (!isLeader) {
    await logWorker("worker", "Cycle skipped — another replica holds the leader lock", "info");
    return;
  }

  isRunning = true;
  // Background lock renewal — refresh TTL every ~2 min so steps that take
  // longer than expected don't lose the lock to another replica.
  const renewTimer = setInterval(() => {
    void renewLeader().catch(() => {});
  }, 2 * 60 * 1000);
  if (typeof renewTimer.unref === "function") renewTimer.unref();

  try {
    await setState("status", "running");
    await setState("last_run", new Date().toISOString());

    const next = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await setState("next_run", next);

    await logWorker("worker", "Worker cycle started");

    // Clean old logs before scanning
    await cleanOldLogs();

    let scanResult = { found: 0, new: 0 };
    let healthResult = { checked: 0, available: 0, cooldown: 0 };
    let examResult: { examined: number; passed: number; failed: number; level: string } = { examined: 0, passed: 0, failed: 0, level: "middle" };

    await logWorker("worker", "Step 0: provider/model auto-discovery disabled — using hardcoded free remote catalog");

    try {
      // Step 1: Scan
      await logWorker("worker", "Step 1: Scanning models");
      scanResult = await scanModels();
    } catch (err) {
      await logWorker("worker", `Step 1 (scan) failed: ${err}`, "error");
    }

    try {
      // Step 2: Health check
      await logWorker("worker", "Step 2: Health check");
      healthResult = await checkHealth();
    } catch (err) {
      await logWorker("worker", `Step 2 (health) failed: ${err}`, "error");
    }

    try {
      // Step 3: สอบคัดเลือก — model ต้องผ่านสอบถึงจะได้ทำงาน
      await logWorker("worker", "Step 3: Exam");
      examResult = await runExams();
    } catch (err) {
      await logWorker("worker", `Step 3 (exam) failed: ${err}`, "error");
    }

    // Step 4: Appoint teachers — principal, heads, proctors จาก performance จริง
    try {
      await logWorker("worker", "Step 4: Appointing teachers");
      const appointed = await appointTeachers();
      if (appointed.principal) {
        await logWorker(
          "worker",
          `👑 Teacher hierarchy: principal=${appointed.principal} | heads=${appointed.heads} | proctors=${appointed.proctors}`,
          "success"
        );
      } else {
        await logWorker("worker", "ยังไม่มี model พอที่จะแต่งตั้งเป็นครู", "warn");
      }
    } catch (err) {
      await logWorker("worker", `Step 4 (teachers) failed: ${err}`, "error");
    }

    await setState(
      "last_stats",
      JSON.stringify({ scan: scanResult, health: healthResult, exam: examResult })
    );

    await logWorker(
      "worker",
      `Cycle complete — scan:${scanResult.found}/${scanResult.new} health:${healthResult.available}/${healthResult.checked} exam:${examResult.passed}✅/${examResult.failed}❌`
    );
  } finally {
    clearInterval(renewTimer);
    // Always reset state — even if a step threw — so the next cycle can run.
    await setState("status", "idle").catch(() => {});
    // Release leader lock at end of cycle so it naturally rotates between replicas
    await releaseLeader().catch(() => {});
    isRunning = false;
  }
}

export function startWorker(): void {
  if (workerTimer) return; // already started

  logWorker("worker", "Worker starting — cycle 15min, verify 3min");

  // Run once immediately (async, don't block)
  runWorkerCycle().catch((err) => {
    logWorker("worker", `Initial cycle error: ${err}`, "error");
    setState("status", "error");
  });

  // Main cycle every 15 minutes (discover + verify + scan + health + exam)
  workerTimer = setInterval(() => {
    runWorkerCycle().catch((err) => {
      logWorker("worker", `Scheduled cycle error: ${err}`, "error");
      setState("status", "error");
    });
  }, 15 * 60 * 1000);
  if (typeof workerTimer.unref === "function") workerTimer.unref();

  // Exam loop every 5 minutes — clears the exam backlog faster than the main
  // 15-minute cycle alone. Leader-locked + skipped if main cycle running.
  examTimer = setInterval(() => {
    runStandaloneExam().catch((err) => {
      logWorker("exam", `Standalone exam error: ${err}`, "error");
    });
  }, 5 * 60 * 1000);
  if (typeof examTimer.unref === "function") examTimer.unref();

  // Warmup pinger — keeps upstream sockets hot between cycles
  startWarmup();
}

/**
 * Stop all scheduled timers + release the Redis leader lock + flush the
 * worker_state status row. Called from the SIGTERM handler so a graceful
 * restart doesn't leave a 14-minute stale lock pointing at the dead replica.
 */
export async function stopWorker(): Promise<void> {
  if (workerTimer) { clearInterval(workerTimer); workerTimer = null; }
  if (examTimer) { clearInterval(examTimer); examTimer = null; }
  try { stopWarmup(); } catch { /* ignore */ }
  // Best-effort flag flip — if isRunning is true we still release the lock
  // so the next replica can pick up immediately.
  await setState("status", "idle").catch(() => {});
  await releaseLeader().catch(() => {});
}

async function runStandaloneExam(): Promise<void> {
  if (examRunning || isRunning) return;
  examRunning = true;
  try {
    const isLeader = await acquireLeader();
    if (!isLeader) return;
    await runExams();
  } finally {
    examRunning = false;
  }
}

export async function getWorkerStatus(): Promise<WorkerStatus> {
  const status = ((await getState("status")) ?? "idle") as WorkerStatus["status"];
  const lastRun = await getState("last_run");
  const nextRun = await getState("next_run");
  const statsRaw = await getState("last_stats");

  let stats: WorkerStatus["stats"] = {};
  if (statsRaw) {
    try {
      stats = JSON.parse(statsRaw);
    } catch {
      // ignore
    }
  }

  return { status, lastRun, nextRun, stats };
}
