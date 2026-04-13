import { getRedis } from "@/lib/redis";

const HEARTBEAT_INTERVAL_MS = 5_000;
const HEARTBEAT_TTL_SEC = 15;

function hostname(): string {
  return process.env.HOSTNAME || process.env.COMPUTERNAME || "local";
}

let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;

async function writeHeartbeat(): Promise<void> {
  try {
    const redis = getRedis();
    const host = hostname();
    const payload = JSON.stringify({
      hostname: host,
      startedAt: new Date().toISOString(),
      pid: process.pid,
    });
    await redis.set(`replica:${host}`, payload, "EX", HEARTBEAT_TTL_SEC);
  } catch {
    // Redis optional — silent
  }
}

export function startHeartbeat(): void {
  if (_heartbeatTimer) return; // already running
  // Write immediately, then on interval
  writeHeartbeat().catch(() => {});
  _heartbeatTimer = setInterval(() => {
    writeHeartbeat().catch(() => {});
  }, HEARTBEAT_INTERVAL_MS);
}

export interface ReplicaInfo {
  hostname: string;
  startedAt: string;
  pid: number;
  ageSec: number;
}

export async function getActiveReplicas(): Promise<ReplicaInfo[]> {
  try {
    const redis = getRedis();

    // Collect all replica:* keys via scan
    const keys: string[] = [];
    const stream = redis.scanStream({ match: "replica:*", count: 100 });
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (batch: string[]) => keys.push(...batch));
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    if (keys.length === 0) return [];

    const values = await redis.mget(...keys);
    const now = Date.now();

    const replicas: ReplicaInfo[] = [];
    for (const raw of values) {
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as { hostname: string; startedAt: string; pid: number };
        const startedMs = new Date(parsed.startedAt).getTime();
        replicas.push({
          hostname: parsed.hostname,
          startedAt: parsed.startedAt,
          pid: parsed.pid,
          ageSec: Math.floor((now - startedMs) / 1000),
        });
      } catch {
        // skip malformed
      }
    }

    return replicas;
  } catch {
    return [];
  }
}
