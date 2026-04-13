import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

let _sql: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

function getSql() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL environment variable is required");
    }
    _sql = postgres(process.env.DATABASE_URL, {
      max: 20,
      idle_timeout: 30,
      connect_timeout: 10,
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
