import { getRedis } from "@/lib/redis";

// ─── Worker leader election ───
// When sml-gateway scales to multiple replicas, only ONE replica should run
// the scan/health cron cycle. We use a Redis SETNX lock with a TTL that's
// slightly longer than the cycle duration.
//
// Fail-closed by default: if Redis is unreachable in production, NO replica
// runs the cycle (better than ALL replicas hammering shared resources).
// To opt back in for single-replica dev setups, set WORKER_LEADER_FAIL_OPEN=1.

const LEADER_KEY = "worker:leader";
const LEADER_TTL_SEC = 14 * 60; // 14 minutes — shorter than the 15min cycle

function workerId(): string {
  // HOSTNAME is set by Docker to the container ID
  return process.env.HOSTNAME || process.env.COMPUTERNAME || "local";
}

function leaderFailOpen(): boolean {
  // Explicit opt-in via env. Also default-on outside production to keep
  // local dev (no Redis container) ergonomic.
  if (process.env.WORKER_LEADER_FAIL_OPEN === "1") return true;
  return process.env.NODE_ENV !== "production";
}

/**
 * Try to become the cycle leader. Returns true if this replica owns the lock
 * for the next cycle window, false if another replica already holds it.
 */
export async function acquireLeader(): Promise<boolean> {
  try {
    const redis = getRedis();
    const me = workerId();
    // SET key value EX seconds NX  →  only set if not exists
    const result = await redis.set(LEADER_KEY, me, "EX", LEADER_TTL_SEC, "NX");
    if (result === "OK") return true;
    // Lock exists — check if we're the current holder (idempotent reruns)
    const holder = await redis.get(LEADER_KEY);
    return holder === me;
  } catch {
    // Redis down → fail-closed in prod, fail-open in dev
    return leaderFailOpen();
  }
}

/**
 * Extend the leader lock during a long-running cycle so another replica
 * doesn't jump in if the current one is mid-work when the TTL expires.
 */
export async function renewLeader(): Promise<void> {
  try {
    const redis = getRedis();
    await redis.expire(LEADER_KEY, LEADER_TTL_SEC);
  } catch {
    // silent
  }
}

/**
 * Release the leader lock early (e.g. on clean shutdown). The lock will
 * expire on its own if the process crashes — this is just courtesy.
 */
export async function releaseLeader(): Promise<void> {
  try {
    const redis = getRedis();
    const me = workerId();
    // Only delete if we still hold it (avoid stealing from another leader)
    const holder = await redis.get(LEADER_KEY);
    if (holder === me) {
      await redis.del(LEADER_KEY);
    }
  } catch {
    // silent
  }
}
