// Re-export getDb from the Postgres client
// All existing imports of getDb from "@/lib/db/schema" continue to work
export { getDb, getSqlClient } from "./client";
