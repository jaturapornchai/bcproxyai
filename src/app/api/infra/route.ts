import { NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/client";
import { getRedis } from "@/lib/redis";
import { getActiveReplicas } from "@/lib/heartbeat";
import { getBattleScore } from "@/lib/battle-score";

export const dynamic = "force-dynamic";

// ─── In-memory memo (5s TTL) ────────────────────────────────────────────────
let _memo: { data: object; ts: number } | null = null;
const MEMO_TTL_MS = 5_000;

// ─── Redis INFO parser ───────────────────────────────────────────────────────
function parseRedisInfo(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\r\n")) {
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

// ─── TTL format helpers ──────────────────────────────────────────────────────
async function safeKeys(pattern: string): Promise<string[]> {
  const redis = getRedis();
  const keys: string[] = [];
  const stream = redis.scanStream({ match: pattern, count: 100 });
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (batch: string[]) => keys.push(...batch));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return keys;
}

// ─── GET /api/infra ──────────────────────────────────────────────────────────
export async function GET() {
  // Serve from memo if fresh
  if (_memo && Date.now() - _memo.ts < MEMO_TTL_MS) {
    return NextResponse.json(_memo.data);
  }

  // ── Postgres ────────────────────────────────────────────────────────────────
  let postgres = {
    ok: false,
    version: "",
    dbSizeBytes: 0,
    connections: 0,
    maxConnections: 0,
    slowQueries: 0,
  };
  try {
    const sql = getSqlClient();

    const [[vRow], [sizeRow], [connRow], [maxRow], [slowRow]] = await Promise.all([
      sql<{ version: string }[]>`SELECT version()`,
      sql<{ size: string }[]>`SELECT pg_database_size(current_database()) AS size`,
      sql<{ count: string }[]>`
        SELECT COUNT(*) AS count FROM pg_stat_activity
        WHERE state = 'active'
      `,
      sql<{ setting: string }[]>`SELECT current_setting('max_connections') AS setting`,
      sql<{ count: string }[]>`
        SELECT COUNT(*) AS count FROM pg_stat_activity
        WHERE state = 'active'
          AND query_start < now() - interval '5 seconds'
          AND query NOT ILIKE '%pg_stat_activity%'
      `,
    ]);

    postgres = {
      ok: true,
      version: (vRow?.version ?? "").split(" ").slice(0, 2).join(" "),
      dbSizeBytes: parseInt(sizeRow?.size ?? "0", 10),
      connections: parseInt(connRow?.count ?? "0", 10),
      maxConnections: parseInt(maxRow?.setting ?? "0", 10),
      slowQueries: parseInt(slowRow?.count ?? "0", 10),
    };
  } catch (err) {
    console.error("[infra] postgres error:", err);
  }

  // ── Redis ────────────────────────────────────────────────────────────────────
  let redis = {
    ok: false,
    engine: "Redis",
    version: "",
    memoryUsedBytes: 0,
    keysTotal: 0,
    uptimeSec: 0,
    hits: 0,
    misses: 0,
    hitRatePct: 0,
  };
  try {
    const r = getRedis();
    const [infoRaw, dbsize] = await Promise.all([
      r.info(),
      r.dbsize(),
    ]);
    const info = parseRedisInfo(infoRaw);

    const hits = parseInt(info["keyspace_hits"] ?? "0", 10);
    const misses = parseInt(info["keyspace_misses"] ?? "0", 10);
    const total = hits + misses;

    const valkeyVersion = info["valkey_version"];
    const engine = valkeyVersion ? "Valkey" : "Redis";
    const version = valkeyVersion ?? info["redis_version"] ?? "";

    redis = {
      ok: true,
      engine,
      version,
      memoryUsedBytes: parseInt(info["used_memory"] ?? "0", 10),
      keysTotal: dbsize,
      uptimeSec: parseInt(info["uptime_in_seconds"] ?? "0", 10),
      hits,
      misses,
      hitRatePct: total > 0 ? Math.round((hits / total) * 100) : 0,
    };
  } catch (err) {
    console.error("[infra] redis error:", err);
  }

  // ── Replicas ─────────────────────────────────────────────────────────────────
  let replicas = {
    count: 0,
    instances: [] as Array<{ hostname: string; startedAt: string; pid: number; ageSec: number }>,
  };
  try {
    const instances = await getActiveReplicas();
    replicas = { count: instances.length, instances };
  } catch {
    // silent
  }

  // ── Rate Limit ───────────────────────────────────────────────────────────────
  let rateLimit = {
    activeClients: 0,
    topClients: [] as Array<{ ip: string; count: number }>,
  };
  try {
    const r = getRedis();
    const rlKeys = await safeKeys("ratelimit:*");
    if (rlKeys.length > 0) {
      const values = await r.mget(...rlKeys);
      const clients: Array<{ ip: string; count: number }> = [];
      for (let i = 0; i < rlKeys.length; i++) {
        const ip = rlKeys[i].replace("ratelimit:", "");
        const count = parseInt(values[i] ?? "0", 10);
        clients.push({ ip, count });
      }
      clients.sort((a, b) => b.count - a.count);
      rateLimit = {
        activeClients: clients.length,
        topClients: clients.slice(0, 5),
      };
    }
  } catch {
    // silent
  }

  // ── Cooldowns ─────────────────────────────────────────────────────────────────
  let cooldowns = {
    providerCount: 0,
    modelCount: 0,
    totalModels: 0,
    providers: [] as Array<{ provider: string; reason: string; ttlSec: number }>,
  };
  try {
    const r = getRedis();
    const cdKeys = await safeKeys("cd:provider:*");
    if (cdKeys.length > 0) {
      const [values, ttls] = await Promise.all([
        r.mget(...cdKeys),
        Promise.all(cdKeys.map((k) => r.ttl(k))),
      ]);
      const providers: Array<{ provider: string; reason: string; ttlSec: number }> = [];
      for (let i = 0; i < cdKeys.length; i++) {
        const provider = cdKeys[i].replace("cd:provider:", "");
        let reason = "";
        try {
          const parsed = JSON.parse(values[i] ?? "{}");
          reason = parsed.reason ?? parsed.error ?? String(values[i] ?? "");
        } catch {
          reason = values[i] ?? "";
        }
        providers.push({ provider, reason, ttlSec: ttls[i] ?? 0 });
      }
      cooldowns.providers = providers;
      cooldowns.providerCount = providers.length;
    }
  } catch {
    // silent
  }

  // Model-level cooldown count (from Postgres health_logs — distinct from provider-level)
  try {
    const sql = getSqlClient();
    const modelRows = await sql<{ total: number; down: number }[]>`
      SELECT
        (SELECT COUNT(*)::int FROM models)                                           AS total,
        (SELECT COUNT(DISTINCT h.model_id)::int
         FROM health_logs h
         INNER JOIN (SELECT model_id, MAX(id) AS max_id FROM health_logs GROUP BY model_id) l
           ON h.model_id = l.model_id AND h.id = l.max_id
         WHERE h.cooldown_until > now())                                             AS down
    `;
    cooldowns.totalModels = Number(modelRows[0]?.total ?? 0);
    cooldowns.modelCount = Number(modelRows[0]?.down ?? 0);
  } catch {
    // silent
  }

  // ── Failure Streaks ───────────────────────────────────────────────────────────
  let failureStreaks: Array<{ provider: string; count: number }> = [];
  try {
    const r = getRedis();
    const fsKeys = await safeKeys("fs:provider:*");
    if (fsKeys.length > 0) {
      const values = await r.mget(...fsKeys);
      const streaks: Array<{ provider: string; count: number }> = [];
      for (let i = 0; i < fsKeys.length; i++) {
        const provider = fsKeys[i].replace("fs:provider:", "");
        const count = parseInt(values[i] ?? "0", 10);
        if (count > 0) streaks.push({ provider, count });
      }
      streaks.sort((a, b) => b.count - a.count);
      failureStreaks = streaks;
    }
  } catch {
    // silent
  }

  // ── Worker Leader ─────────────────────────────────────────────────────────────
  let workerLeader = { hostname: null as string | null, ttlSec: 0 };
  try {
    const r = getRedis();
    const [holder, ttl] = await Promise.all([
      r.get("worker:leader"),
      r.ttl("worker:leader"),
    ]);
    workerLeader = { hostname: holder, ttlSec: Math.max(0, ttl) };
  } catch {
    // silent
  }

  // ── k6 load-test runs ─────────────────────────────────────────────────────────
  // Scripts are static files in loadtest/; last-run summaries live in Redis
  // (each script POSTs to /api/k6-report at the end via k6's handleSummary hook).
  const k6Scripts = [
    { name: "smoke",     description: "sanity check (1 VU, 10s)" },
    { name: "dashboard", description: "ramp to 50 VUs hitting dashboard endpoints" },
    { name: "chat",      description: "ramp to 30 VUs on /v1/chat/completions" },
    { name: "ratelimit", description: "150 iter, verifies 429 rate limiter" },
    { name: "stress",    description: "ramp to 500 VUs — find the breaking point" },
  ];
  type K6Run = {
    script: string;
    at: string;
    checks: { passes?: number; fails?: number };
    metrics: Record<string, number | undefined>;
    duration?: number;
    vus?: number;
  };
  let k6LastRuns: K6Run[] = [];
  let k6Latest: K6Run | null = null;
  try {
    const keys = await safeKeys("k6:last:*");
    if (keys.length > 0) {
      const r = getRedis();
      const values = await r.mget(...keys);
      k6LastRuns = values
        .filter((v): v is string => v !== null)
        .map(v => { try { return JSON.parse(v) as K6Run; } catch { return null; } })
        .filter((x): x is K6Run => x !== null)
        .sort((a, b) => (b.at > a.at ? 1 : -1));
    }
    const latestRaw = await getRedis().get("k6:latest");
    if (latestRaw) { try { k6Latest = JSON.parse(latestRaw) as K6Run; } catch { /* silent */ } }
  } catch {
    // silent
  }

  const result = {
    postgres,
    redis,
    replicas,
    rateLimit,
    cooldowns,
    failureStreaks,
    workerLeader,
    k6: {
      scripts: k6Scripts,
      lastRuns: k6LastRuns,
      latest: k6Latest,
    },
    serverTime: new Date().toISOString(),
    battle: await getBattleScore(),
  };

  _memo = { data: result, ts: Date.now() };
  return NextResponse.json(result);
}
