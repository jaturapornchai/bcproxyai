/**
 * One-time migration: copy api_keys from SQLite → PostgreSQL.
 * Run with: npm run migrate:data
 * Requires DATABASE_URL env var pointing to Postgres.
 */

import Database from "better-sqlite3";
import postgres from "postgres";
import path from "path";
import fs from "fs";

const SQLITE_PATH = path.resolve(process.cwd(), "data", "sml-gateway.db");

async function main() {
  if (!fs.existsSync(SQLITE_PATH)) {
    console.log(`SQLite DB not found at ${SQLITE_PATH} — nothing to migrate.`);
    process.exit(0);
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  console.log(`Reading SQLite from: ${SQLITE_PATH}`);
  const sqlite = new Database(SQLITE_PATH, { readonly: true });

  let rows: { provider: string; api_key: string; updated_at: string }[] = [];
  try {
    rows = sqlite
      .prepare("SELECT provider, api_key, updated_at FROM api_keys")
      .all() as typeof rows;
  } catch (e) {
    console.log("No api_keys table in SQLite (or empty) — skipping.");
    sqlite.close();
    process.exit(0);
  }

  sqlite.close();

  if (rows.length === 0) {
    console.log("api_keys table is empty — nothing to migrate.");
    process.exit(0);
  }

  console.log(`Found ${rows.length} api_key row(s). Connecting to Postgres...`);
  const sql = postgres(dbUrl, { max: 1 });

  let migrated = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      await sql`
        INSERT INTO api_keys (provider, api_key, updated_at)
        VALUES (${row.provider}, ${row.api_key}, ${row.updated_at}::timestamptz)
        ON CONFLICT (provider) DO UPDATE
          SET api_key = EXCLUDED.api_key,
              updated_at = EXCLUDED.updated_at
      `;
      console.log(`  Migrated: ${row.provider}`);
      migrated++;
    } catch (err) {
      console.warn(`  Skipped ${row.provider}: ${err}`);
      skipped++;
    }
  }

  await sql.end();

  console.log(`\nDone. Migrated: ${migrated}, Skipped: ${skipped}`);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
