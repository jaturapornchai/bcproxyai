/**
 * Semantic Cache — store responses indexed by message embedding
 *
 * Lookup: cosine similarity > threshold → return cached response
 * Store:  embed query + response, persist to pgvector table
 *
 * Embedding source: Ollama local `nomic-embed-text` (free, no external API)
 * Fallback: if Ollama or pgvector unavailable, operations no-op gracefully
 */
import { getSqlClient } from "@/lib/db/schema";
import { createHash } from "crypto";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const EMBED_MODEL = "nomic-embed-text";
const DEFAULT_THRESHOLD = 0.92;
const EMBED_TIMEOUT_MS = 3_000;

export interface SemanticHit {
  query: string;
  response: Record<string, unknown>;
  provider: string | null;
  model: string | null;
  similarity: number;
  hit_count: number;
}

function hashQuery(query: string): string {
  return createHash("sha256").update(query).digest("hex").slice(0, 32);
}

async function embedQuery(query: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: query }),
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const embedding = json.embedding as number[] | undefined;
    return Array.isArray(embedding) && embedding.length > 0 ? embedding : null;
  } catch {
    return null;
  }
}

function vectorLiteral(vec: number[]): string {
  return "[" + vec.join(",") + "]";
}

/**
 * Look up cached response by semantic similarity.
 * Returns null if no match or any error (graceful fallback).
 */
export async function getCachedBySimilarity(
  query: string,
  threshold: number = DEFAULT_THRESHOLD
): Promise<SemanticHit | null> {
  if (!query || query.length < 10) return null;
  const embedding = await embedQuery(query);
  if (!embedding) return null;
  try {
    const sql = getSqlClient();
    const vecStr = vectorLiteral(embedding);
    const rows = await sql<Array<{
      query: string;
      response: Record<string, unknown>;
      provider: string | null;
      model: string | null;
      similarity: number;
      hit_count: number;
    }>>`
      SELECT query, response, provider, model, hit_count,
             1 - (embedding <=> ${vecStr}::vector) AS similarity
      FROM semantic_cache
      ORDER BY embedding <=> ${vecStr}::vector
      LIMIT 1
    `;
    const row = rows[0];
    if (!row || row.similarity < threshold) return null;
    // Update hit count + last_used_at (fire and forget)
    sql`
      UPDATE semantic_cache
      SET hit_count = hit_count + 1, last_used_at = now()
      WHERE query = ${row.query}
    `.catch(() => {});
    return row;
  } catch {
    return null;
  }
}

/**
 * Store response with embedding. Idempotent via query_hash.
 */
export async function storeSemanticResponse(
  query: string,
  response: Record<string, unknown>,
  provider: string | null,
  model: string | null
): Promise<void> {
  if (!query || query.length < 10) return;
  const embedding = await embedQuery(query);
  if (!embedding) return;
  try {
    const sql = getSqlClient();
    const hash = hashQuery(query);
    const vecStr = vectorLiteral(embedding);
    await sql`
      INSERT INTO semantic_cache (query_hash, query, embedding, response, provider, model)
      VALUES (${hash}, ${query.slice(0, 2000)}, ${vecStr}::vector, ${JSON.stringify(response)}::jsonb, ${provider}, ${model})
      ON CONFLICT (query_hash) DO UPDATE SET
        last_used_at = now(),
        hit_count = semantic_cache.hit_count + 1
    `;
  } catch {
    // silent — cache is optional
  }
}

export async function getSemanticCacheStats(): Promise<{
  total: number;
  hits: number;
  avgHits: number;
}> {
  try {
    const sql = getSqlClient();
    const rows = await sql<{ total: number; hits: number; avg: number }[]>`
      SELECT COUNT(*)::int as total,
             COALESCE(SUM(hit_count), 0)::int as hits,
             COALESCE(AVG(hit_count), 0)::float as avg
      FROM semantic_cache
    `;
    const r = rows[0];
    return { total: r?.total ?? 0, hits: r?.hits ?? 0, avgHits: r?.avg ?? 0 };
  } catch {
    return { total: 0, hits: 0, avgHits: 0 };
  }
}
