import { createHash } from "node:crypto";
import { getSqlClient } from "./db/client";

const OLLAMA_EMBED_URL =
  process.env.OLLAMA_EMBED_URL || "http://host.docker.internal:11434/api/embeddings";
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
const EMBED_TIMEOUT_MS = 3000;

// ตรวจครั้งเดียวว่า pgvector ใช้ได้มั้ย — log once
let pgvectorAvailable: boolean | null = null;

async function checkPgvector(): Promise<boolean> {
  if (pgvectorAvailable !== null) return pgvectorAvailable;
  try {
    const sql = getSqlClient();
    const rows = await sql<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'vector'
    `;
    pgvectorAvailable = rows.length > 0;
    if (!pgvectorAvailable) {
      console.warn("[SEMCACHE] pgvector extension not installed — semantic cache disabled");
    } else {
      console.log("[SEMCACHE] pgvector available");
    }
  } catch (e) {
    pgvectorAvailable = false;
    console.warn("[SEMCACHE] pgvector check failed:", (e as Error).message);
  }
  return pgvectorAvailable;
}

function hashQuery(q: string): string {
  return createHash("sha256").update(q).digest("hex");
}

function toVectorLiteral(vec: number[]): string {
  // pgvector รับเป็น string literal "[1,2,3]"
  return `[${vec.join(",")}]`;
}

async function embed(text: string): Promise<number[] | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), EMBED_TIMEOUT_MS);
    const res = await fetch(OLLAMA_EMBED_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      console.warn(`[SEMCACHE] embed HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { embedding?: number[] };
    if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
      console.warn("[SEMCACHE] embed returned empty vector");
      return null;
    }
    return data.embedding;
  } catch (e) {
    console.warn("[SEMCACHE] embed failed:", (e as Error).message);
    return null;
  }
}

function tenantNamespace(apiKey: string | null | undefined): string {
  if (!apiKey) return "_anon";
  if (apiKey.startsWith("sml_live_")) return apiKey.slice(0, 18);
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 12);
}

export async function getCachedBySimilarity(
  userMsg: string,
  threshold = 0.92,
  opts: { apiKey?: string | null; skip?: boolean; tenantNs?: string } = {},
): Promise<{ response: unknown; provider: string; model: string } | null> {
  if (opts.skip) return null;
  try {
    if (!(await checkPgvector())) return null;
    const vec = await embed(userMsg);
    if (!vec) return null;
    const sql = getSqlClient();
    const lit = toVectorLiteral(vec);
    const ns = opts.tenantNs ?? tenantNamespace(opts.apiKey);
    // Cosine distance ranges 0..2; similarity = 1 - distance, so the threshold
    // 0.92 maps to max distance 0.08. Filtering here lets pgvector use the
    // HNSW/IVFFlat index for ANN ordering AND prune unrelated vectors instead
    // of scanning the whole tenant partition just to discard them client-side.
    const maxDistance = 1 - threshold;
    const rows = await sql<
      {
        response: unknown;
        provider: string | null;
        model: string | null;
        distance: number;
        id: number;
      }[]
    >`
      SELECT id, response, provider, model, (embedding <=> ${lit}::vector) AS distance
      FROM semantic_cache
      WHERE embedding IS NOT NULL
        AND tenant_ns = ${ns}
        AND (embedding <=> ${lit}::vector) < ${maxDistance}
      ORDER BY embedding <=> ${lit}::vector
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    const row = rows[0];
    const similarity = 1 - Number(row.distance);
    if (similarity < threshold) return null;
    // fire-and-forget hit update
    sql`UPDATE semantic_cache SET hit_count = hit_count + 1, last_used_at = now() WHERE id = ${row.id}`.catch(
      () => {},
    );
    console.log(`[SEMCACHE] hit similarity=${similarity.toFixed(4)}`);
    return {
      response: row.response,
      provider: row.provider ?? "",
      model: row.model ?? "",
    };
  } catch (e) {
    console.warn("[SEMCACHE] getCachedBySimilarity failed:", (e as Error).message);
    return null;
  }
}

export async function storeSemanticResponse(
  userMsg: string,
  response: unknown,
  provider: string,
  model: string,
  opts: { apiKey?: string | null; skip?: boolean; tenantNs?: string } = {},
): Promise<void> {
  if (opts.skip) return;
  try {
    if (!(await checkPgvector())) return;
    const vec = await embed(userMsg);
    if (!vec) return;
    const sql = getSqlClient();
    const lit = toVectorLiteral(vec);
    const hash = hashQuery(userMsg);
    const ns = opts.tenantNs ?? tenantNamespace(opts.apiKey);
    await sql`
      INSERT INTO semantic_cache (query_hash, query, embedding, response, provider, model, tenant_ns)
      VALUES (${hash}, ${userMsg}, ${lit}::vector, ${JSON.stringify(response)}::jsonb, ${provider}, ${model}, ${ns})
      ON CONFLICT (tenant_ns, query_hash) DO UPDATE
      SET hit_count = semantic_cache.hit_count + 1,
          last_used_at = now()
    `;
    console.log("[SEMCACHE] stored");
  } catch (e) {
    console.warn("[SEMCACHE] storeSemanticResponse failed:", (e as Error).message);
  }
}
