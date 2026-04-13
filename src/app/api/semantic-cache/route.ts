import { NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

interface CacheEntry {
  id: number;
  query: string;
  provider: string | null;
  model: string | null;
  hitCount: number;
  createdAt: string;
  lastUsedAt: string;
}

interface CacheStats {
  total: number;
  totalHits: number;
  avgHits: number;
  topEntries: CacheEntry[];
  enabled: boolean;
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
        total: 0,
        totalHits: 0,
        avgHits: 0,
        topEntries: [],
        enabled: false,
      });
    }

    const statsRows = await sql<{ total: number; hits: number; avg: number }[]>`
      SELECT
        COUNT(*)::int AS total,
        COALESCE(SUM(hit_count), 0)::int AS hits,
        COALESCE(AVG(hit_count), 0)::float AS avg
      FROM semantic_cache
    `;

    const topRows = await sql<CacheEntry[]>`
      SELECT
        id,
        query,
        provider,
        model,
        hit_count AS "hitCount",
        created_at AS "createdAt",
        last_used_at AS "lastUsedAt"
      FROM semantic_cache
      ORDER BY hit_count DESC, last_used_at DESC
      LIMIT 20
    `;

    const s = statsRows[0];
    return NextResponse.json<CacheStats>({
      total: s?.total ?? 0,
      totalHits: s?.hits ?? 0,
      avgHits: Math.round((s?.avg ?? 0) * 10) / 10,
      topEntries: topRows,
      enabled: true,
    });
  } catch (err) {
    return NextResponse.json<CacheStats>({
      total: 0,
      totalHits: 0,
      avgHits: 0,
      topEntries: [],
      enabled: false,
    });
  }
}
