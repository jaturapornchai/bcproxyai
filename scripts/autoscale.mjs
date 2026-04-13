#!/usr/bin/env node
/**
 * BCProxyAI autoscaler — rule-based, polls Postgres for real traffic metrics
 * and scales the `bcproxyai` service via `docker compose --scale`.
 *
 * Run from the project root:
 *   node scripts/autoscale.mjs
 *   # or: npm run autoscale
 *
 * Environment variables (all optional):
 *   DATABASE_URL          postgres://bcproxy:bcproxy@localhost:5434/bcproxyai
 *   MIN_REPLICAS          1        (never scale below this)
 *   MAX_REPLICAS          4        (never scale above this)
 *   CHECK_INTERVAL_SEC    30       (poll cadence)
 *   SCALE_COOLDOWN_SEC    90       (minimum seconds between two scale decisions)
 *   P95_UP_MS             5000     (scale up if p95 latency exceeds this)
 *   AVG_DOWN_MS           1500     (scale down only if avg latency is below this)
 *   ERR_RATE_UP_PCT       20       (scale up if error rate over 2min exceeds this %)
 *   LOW_TRAFFIC_REQ       5        (scale down if fewer than N requests in 2min)
 *   SCALE_WEBHOOK_URL     (optional) Discord/Slack-compatible webhook for notifications
 *
 * The scale decisions look at the last 2 minutes of gateway_logs.
 * Scaling actions respect SCALE_COOLDOWN_SEC so the system can settle.
 */
import postgres from "postgres";
import { execSync } from "node:child_process";

// ── Config ───────────────────────────────────────────────────────────
const DB_URL =
  process.env.DATABASE_URL ||
  "postgres://bcproxy:bcproxy@localhost:5434/bcproxyai";
const MIN_REPLICAS = parseInt(process.env.MIN_REPLICAS || "1", 10);
const MAX_REPLICAS = parseInt(process.env.MAX_REPLICAS || "4", 10);
const CHECK_INTERVAL_MS =
  parseInt(process.env.CHECK_INTERVAL_SEC || "30", 10) * 1000;
const SCALE_COOLDOWN_MS =
  parseInt(process.env.SCALE_COOLDOWN_SEC || "90", 10) * 1000;
const P95_UP_MS = parseInt(process.env.P95_UP_MS || "5000", 10);
const AVG_DOWN_MS = parseInt(process.env.AVG_DOWN_MS || "1500", 10);
const ERR_RATE_UP_PCT = parseInt(process.env.ERR_RATE_UP_PCT || "20", 10);
const LOW_TRAFFIC_REQ = parseInt(process.env.LOW_TRAFFIC_REQ || "5", 10);
const WEBHOOK_URL = process.env.SCALE_WEBHOOK_URL || "";

// ── State ────────────────────────────────────────────────────────────
let lastScaleAt = 0;
let lastScaleAction = "start";
const sql = postgres(DB_URL, { max: 2, idle_timeout: 10 });

// ── Helpers ──────────────────────────────────────────────────────────
function ts() {
  return new Date().toISOString().slice(11, 19);
}

function log(tag, msg) {
  console.log(`[${ts()}] [${tag}] ${msg}`);
}

async function getMetrics() {
  const rows = await sql`
    SELECT
      COUNT(*)::int                                                          AS req_count,
      COALESCE(AVG(latency_ms)::int, 0)                                      AS avg_latency,
      COALESCE(
        (PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms))::int, 0
      )                                                                      AS p95_latency,
      COALESCE(
        (PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms))::int, 0
      )                                                                      AS p99_latency,
      COUNT(*) FILTER (WHERE status >= 400)::int                             AS err_count
    FROM gateway_logs
    WHERE created_at > NOW() - INTERVAL '2 minutes'
  `;
  return rows[0];
}

function getCurrentReplicas() {
  try {
    const out = execSync("docker compose ps bcproxyai -q", {
      encoding: "utf8",
      cwd: process.cwd(),
    });
    const ids = out.trim().split("\n").filter(Boolean);
    return ids.length;
  } catch (err) {
    log("WARN", `failed to read replica count: ${err.message}`);
    return 1;
  }
}

function scaleTo(n, reason) {
  log("SCALE", `${lastScaleAction === "start" ? "?" : ""} → ${n} replicas (${reason})`);
  try {
    execSync(
      `docker compose up -d --scale bcproxyai=${n} --no-recreate`,
      { stdio: "pipe", cwd: process.cwd() }
    );
    lastScaleAt = Date.now();
    lastScaleAction = `→${n}`;
    notify(`BCProxyAI autoscaled to ${n} replicas — ${reason}`);
  } catch (err) {
    log("ERROR", `scale command failed: ${err.message}`);
  }
}

function notify(text) {
  if (!WEBHOOK_URL) return;
  fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text, text }),
  }).catch((err) => log("WARN", `webhook failed: ${err.message}`));
}

// ── Main loop ────────────────────────────────────────────────────────
async function tick() {
  let m;
  try {
    m = await getMetrics();
  } catch (err) {
    log("ERROR", `metrics query failed: ${err.message}`);
    return;
  }

  const replicas = getCurrentReplicas();
  const errRate = m.req_count > 0 ? (m.err_count / m.req_count) * 100 : 0;

  log(
    "METRIC",
    `replicas=${replicas} req=${m.req_count}/2m avg=${m.avg_latency}ms p95=${m.p95_latency}ms p99=${m.p99_latency}ms err=${errRate.toFixed(1)}%`
  );

  const cooldownLeft = SCALE_COOLDOWN_MS - (Date.now() - lastScaleAt);
  if (cooldownLeft > 0) {
    log("COOL", `${Math.ceil(cooldownLeft / 1000)}s until next scale decision`);
    return;
  }

  // Scale up — slow or errors
  if (m.p95_latency > P95_UP_MS && replicas < MAX_REPLICAS) {
    return scaleTo(replicas + 1, `p95 ${m.p95_latency}ms > ${P95_UP_MS}ms`);
  }
  if (errRate > ERR_RATE_UP_PCT && replicas < MAX_REPLICAS && m.req_count > 10) {
    return scaleTo(
      replicas + 1,
      `err rate ${errRate.toFixed(1)}% > ${ERR_RATE_UP_PCT}%`
    );
  }

  // Scale down — low traffic or consistently fast
  if (m.req_count < LOW_TRAFFIC_REQ && replicas > MIN_REPLICAS) {
    return scaleTo(
      replicas - 1,
      `idle: ${m.req_count} req/2m < ${LOW_TRAFFIC_REQ}`
    );
  }
  if (
    m.avg_latency > 0 &&
    m.avg_latency < AVG_DOWN_MS &&
    m.req_count < 30 &&
    replicas > MIN_REPLICAS
  ) {
    return scaleTo(
      replicas - 1,
      `fast+quiet: avg ${m.avg_latency}ms, ${m.req_count} req/2m`
    );
  }

  log("HOLD", `within bounds — no action`);
}

// ── Boot ─────────────────────────────────────────────────────────────
log(
  "BOOT",
  `min=${MIN_REPLICAS} max=${MAX_REPLICAS} interval=${CHECK_INTERVAL_MS / 1000}s cooldown=${SCALE_COOLDOWN_MS / 1000}s`
);
log(
  "BOOT",
  `rules: p95>${P95_UP_MS}ms→+1, err>${ERR_RATE_UP_PCT}%→+1, req<${LOW_TRAFFIC_REQ}/2m→-1`
);
if (WEBHOOK_URL) log("BOOT", "webhook notifications enabled");

process.on("SIGINT", async () => {
  log("BOOT", "shutting down");
  await sql.end({ timeout: 5 });
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await sql.end({ timeout: 5 });
  process.exit(0);
});

// Run immediately, then on interval
await tick();
setInterval(tick, CHECK_INTERVAL_MS);
