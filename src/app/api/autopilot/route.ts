import { NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";
import { getPerfCounts } from "@/lib/perf-counters";
import { getRedis } from "@/lib/redis";

export const dynamic = "force-dynamic";

/**
 * /api/autopilot — rule-based ops recommendation cards.
 *
 * Each rule reads from existing tables/counters (gateway_logs, latest_model_health,
 * perf counters, circuit-breaker keys) and emits at most one card per rule
 * when its threshold is crossed. No LLM calls — deterministic + cheap.
 *
 * Card shape:
 *   { id, severity, title, summary, action, evidence }
 *
 * Severities: "info" | "warn" | "critical"
 */

type Severity = "info" | "warn" | "critical";

interface Card {
  id: string;
  severity: Severity;
  title: string;
  summary: string;
  action: string;
  evidence: Record<string, number | string>;
}

async function scanCount(pattern: string): Promise<number> {
  try {
    const redis = getRedis();
    let cursor = "0";
    let count = 0;
    do {
      const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
      count += batch.length;
      cursor = next;
    } while (cursor !== "0");
    return count;
  } catch {
    return 0;
  }
}

export async function GET() {
  const cards: Card[] = [];
  const sql = getSqlClient();

  try {
    const [providerStatsRows, slowModelRows, cooldownRows, fallbackRows, perfCounts, openCircuits] = await Promise.all([
      sql<{ provider: string; total: number; errors: number; avg_ms: number }[]>`
        SELECT
          COALESCE(provider, 'unknown') AS provider,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status >= 400)::int AS errors,
          COALESCE(AVG(latency_ms), 0)::int AS avg_ms
        FROM gateway_logs
        WHERE created_at > now() - interval '1 hour'
        GROUP BY provider
        HAVING COUNT(*) >= 10
      `,
      sql<{ resolved_model: string; provider: string; p95: number; total: number }[]>`
        SELECT
          resolved_model,
          COALESCE(provider, 'unknown') AS provider,
          COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)::int AS p95,
          COUNT(*)::int AS total
        FROM gateway_logs
        WHERE created_at > now() - interval '1 hour'
          AND resolved_model IS NOT NULL
          AND status < 400
        GROUP BY resolved_model, provider
        HAVING COUNT(*) >= 10
        ORDER BY p95 DESC
        LIMIT 5
      `,
      sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM latest_model_health WHERE cooldown_until > now()
      `,
      sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM gateway_logs
        WHERE created_at > now() - interval '1 hour'
          AND routing_explain IS NOT NULL
          AND (routing_explain ->> 'fallbackUsed')::boolean = true
      `.catch(() => [{ count: 0 }]),
      getPerfCounts().catch(() => null),
      scanCount("cb:open:*"),
    ]);

    // RULE 1 — provider error-rate spike
    for (const p of providerStatsRows) {
      const rate = p.total > 0 ? p.errors / p.total : 0;
      if (rate >= 0.2) {
        cards.push({
          id: `provider-error-rate:${p.provider}`,
          severity: rate >= 0.5 ? "critical" : "warn",
          title: `${p.provider} error rate ${Math.round(rate * 100)}%`,
          summary: `${p.errors}/${p.total} requests in the last hour returned 4xx/5xx.`,
          action: "Check upstream status; consider pausing this provider in /admin/providers if it persists.",
          evidence: { errorRate: Math.round(rate * 1000) / 1000, total: p.total, errors: p.errors },
        });
      }
    }

    // RULE 2 — extreme latency (p95 > 8s on a model with >=10 requests)
    for (const m of slowModelRows) {
      if (m.p95 > 8000) {
        cards.push({
          id: `slow-model:${m.provider}/${m.resolved_model}`,
          severity: m.p95 > 15000 ? "warn" : "info",
          title: `${m.provider}/${m.resolved_model} p95 ${m.p95}ms`,
          summary: `Top of the slow-model list this hour. ${m.total} requests sampled.`,
          action: "Confirm whether the model is throttled by the upstream; reduce its category boost if it stays slow.",
          evidence: { p95Ms: m.p95, totalRequests: m.total },
        });
      }
    }

    // RULE 3 — many models in cooldown
    const cooldownCount = Number(cooldownRows[0]?.count ?? 0);
    if (cooldownCount >= 10) {
      cards.push({
        id: "many-cooldowns",
        severity: cooldownCount >= 30 ? "warn" : "info",
        title: `${cooldownCount} models currently in cooldown`,
        summary: "Cooldown waves usually mean a wave of upstream errors or 429s.",
        action: "Inspect /admin/circuits + recent gateway_logs for the failing provider(s).",
        evidence: { cooldownModels: cooldownCount },
      });
    }

    // RULE 4 — fallback path used heavily
    const fallbackCount = Number(fallbackRows[0]?.count ?? 0);
    if (fallbackCount >= 20) {
      cards.push({
        id: "fallback-heavy",
        severity: "warn",
        title: `Fallback used in ${fallbackCount} requests this hour`,
        summary: "selectModelsByMode returned 0 candidates frequently — exam scoring may be flapping.",
        action: "Check exam_attempts; consider pausing benchmark or raising the freshness window.",
        evidence: { fallbackHits: fallbackCount },
      });
    }

    // RULE 5 — semantic cache hit-rate too low
    const cacheHits = perfCounts?.["cache:hit"] ?? 0;
    const cacheMiss = perfCounts?.["cache:miss"] ?? 0;
    const cacheLookups = cacheHits + cacheMiss;
    if (cacheLookups >= 100) {
      const rate = cacheHits / cacheLookups;
      if (rate < 0.05) {
        cards.push({
          id: "cache-hit-rate-low",
          severity: "info",
          title: `Cache hit rate ${Math.round(rate * 100)}%`,
          summary: `Only ${cacheHits} hits over ${cacheLookups} lookups — cache barely paying off.`,
          action: "Consider raising similarity threshold or letting more entries warm up; review semantic_cache stale entries.",
          evidence: { hitRate: Math.round(rate * 1000) / 1000, hits: cacheHits, misses: cacheMiss },
        });
      }
    }

    // RULE 6 — circuits open
    if (openCircuits >= 5) {
      cards.push({
        id: "circuits-open",
        severity: openCircuits >= 20 ? "critical" : "warn",
        title: `${openCircuits} circuit breakers tripped`,
        summary: "Persistent failures opened the circuits — these (provider, model) pairs are short-circuited.",
        action: "Visit /admin/circuits to inspect; clear individual circuits after upstream recovers.",
        evidence: { openCircuits },
      });
    }

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      windowMin: 60,
      cards,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 200), cards: [] }, { status: 500 });
  }
}
