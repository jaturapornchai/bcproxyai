import { NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";
import { getPerfCounts } from "@/lib/perf-counters";

export const dynamic = "force-dynamic";

const SHOW_QUERY_PREVIEW = process.env.SEMANTIC_CACHE_SHOW_PREVIEW === "1";

interface CacheEntryRaw {
  id: number;
  query: string;
  query_hash: string;
  provider: string | null;
  model: string | null;
  hitCount: number;
  createdAt: string;
  lastUsedAt: string;
}

interface CacheEntry {
  id: number;
  queryHash: string;
  queryPreview: string;
  queryLength: number;
  provider: string | null;
  model: string | null;
  hitCount: number;
  createdAt: string;
  lastUsedAt: string;
}

interface ProviderAgg {
  provider: string | null;
  model: string | null;
  entries: number;
  totalHits: number;
}

interface CacheStats {
  total: number;
  totalHits: number;
  avgHits: number;
  topEntries: CacheEntry[];
  enabled: boolean;
  // ── analytics extension ──
  hitRate: number;            // 0..1, from perf counters (cache:hit / total)
  hitsLastHour: number;
  missesLastHour: number;
  estimatedSavedRequests: number; // sum(hit_count) over all entries
  topProviders: ProviderAgg[];
  staleEntries: number;       // not used in 30 days
  staleSamples: CacheEntry[];
}

export async function GET() {
  try {
    const sql = getSqlClient();

    // Check if semantic_cache table exists (graceful if pgvector not installed)
    const tableExists = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'semantic_cache'
      )
    `;

    if (!tableExists[0]?.exists) {
      return NextResponse.json<CacheStats>({
        total: 0, totalHits: 0, avgHits: 0, topEntries: [], enabled: false,
        hitRate: 0, hitsLastHour: 0, missesLastHour: 0,
        estimatedSavedRequests: 0, topProviders: [], staleEntries: 0, staleSamples: [],
      });
    }

    const [statsRows, topRowsRaw, perfCounts, providerRows, staleCountRows, staleRowsRaw] = await Promise.all([
      sql<{ total: number; hits: number; avg: number }[]>`
        SELECT
          COUNT(*)::int AS total,
          COALESCE(SUM(hit_count), 0)::int AS hits,
          COALESCE(AVG(hit_count), 0)::float AS avg
        FROM semantic_cache
      `,
      sql<CacheEntryRaw[]>`
        SELECT
          id, query, query_hash, provider, model,
          hit_count AS "hitCount",
          created_at AS "createdAt",
          last_used_at AS "lastUsedAt"
        FROM semantic_cache
        ORDER BY hit_count DESC, last_used_at DESC
        LIMIT 20
      `,
      getPerfCounts().catch(() => null),
      sql<ProviderAgg[]>`
        SELECT
          provider,
          model,
          COUNT(*)::int AS entries,
          COALESCE(SUM(hit_count), 0)::int AS "totalHits"
        FROM semantic_cache
        WHERE provider IS NOT NULL
        GROUP BY provider, model
        ORDER BY "totalHits" DESC
        LIMIT 10
      `,
      sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM semantic_cache
        WHERE last_used_at < now() - interval '30 days'
      `,
      sql<CacheEntryRaw[]>`
        SELECT
          id, query, query_hash, provider, model,
          hit_count AS "hitCount",
          created_at AS "createdAt",
          last_used_at AS "lastUsedAt"
        FROM semantic_cache
        WHERE last_used_at < now() - interval '30 days'
        ORDER BY last_used_at ASC
        LIMIT 10
      `,
    ]);

    const PREVIEW_LEN = 40;
    const toEntry = (r: CacheEntryRaw): CacheEntry => ({
      id: r.id,
      queryHash: r.query_hash.slice(0, 12),
      // Don't ship user prompt text by default. Admins still get hash + length;
      // local debugging can opt in to a short preview with SEMANTIC_CACHE_SHOW_PREVIEW=1.
      queryPreview: SHOW_QUERY_PREVIEW
        ? (r.query.length > PREVIEW_LEN ? r.query.slice(0, PREVIEW_LEN) + "..." : r.query)
        : "",
      queryLength: r.query.length,
      provider: r.provider,
      model: r.model,
      hitCount: r.hitCount,
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt,
    });

    const cacheHits = perfCounts?.["cache:hit"] ?? 0;
    const cacheMiss = perfCounts?.["cache:miss"] ?? 0;
    const lookups = cacheHits + cacheMiss;

    const s = statsRows[0];
    return NextResponse.json<CacheStats>({
      total: s?.total ?? 0,
      totalHits: s?.hits ?? 0,
      avgHits: Math.round((s?.avg ?? 0) * 10) / 10,
      topEntries: topRowsRaw.map(toEntry),
      enabled: true,
      hitRate: lookups > 0 ? cacheHits / lookups : 0,
      hitsLastHour: cacheHits,
      missesLastHour: cacheMiss,
      // 1 hit ≈ 1 saved upstream request. Better than nothing without per-row
      // token totals; the dashboard labels this as "estimated".
      estimatedSavedRequests: s?.hits ?? 0,
      topProviders: providerRows,
      staleEntries: Number(staleCountRows[0]?.count ?? 0),
      staleSamples: staleRowsRaw.map(toEntry),
    });
  } catch (err) {
    console.warn("[semantic-cache] error:", err);
    return NextResponse.json<CacheStats>({
      total: 0, totalHits: 0, avgHits: 0, topEntries: [], enabled: false,
      hitRate: 0, hitsLastHour: 0, missesLastHour: 0,
      estimatedSavedRequests: 0, topProviders: [], staleEntries: 0, staleSamples: [],
    });
  }
}
