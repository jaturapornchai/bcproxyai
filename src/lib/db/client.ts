import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

let _sql: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

function clampInt(raw: string | undefined, def: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.max(Math.floor(n), min), max);
}

function getSql() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL environment variable is required");
    }
    _sql = postgres(process.env.DATABASE_URL, {
      max: clampInt(process.env.PG_POOL_MAX, 20, 1, 200),
      idle_timeout: clampInt(process.env.PG_IDLE_TIMEOUT_SEC, 30, 1, 3600),
      connect_timeout: clampInt(process.env.PG_CONNECT_TIMEOUT_SEC, 10, 1, 120),
    });
  }
  return _sql;
}

export function getDb() {
  if (!_db) {
    _db = drizzle(getSql());
  }
  return _db;
}

// Export raw sql tag for complex queries
export function getSqlClient() {
  return getSql();
}
