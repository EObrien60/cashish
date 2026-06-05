import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { applySchema, SCHEMA_VERSION } from "./migrate";
import { seedInto } from "./seed";

// ---------------------------------------------------------------------------
// Single point of DB coupling. The rest of the app imports `db` and `schema`
// only. To move off SQLite later, swap this file for the matching drizzle
// driver (e.g. drizzle-orm/postgres-js) and update drizzle.config.ts — the
// query code in src/lib/* is written against the portable drizzle query API.
//
// Schema + seed run once per process on connection open. One connection per
// process avoids intra-process locking; busy_timeout makes cross-process
// access (e.g. parallel build workers) wait rather than throw SQLITE_BUSY.
// ---------------------------------------------------------------------------

const DB_PATH = process.env.DATABASE_URL ?? "./cashish.db";

declare global {
  // eslint-disable-next-line no-var
  var __cashish_db__: ReturnType<typeof createDb> | undefined;
}

function createDb() {
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 10000");
  sqlite.pragma("foreign_keys = ON");

  // Migrations are gated on PRAGMA user_version. Existing databases re-run the
  // (idempotent, IF-NOT-EXISTS) DDL once when SCHEMA_VERSION bumps, picking up
  // new tables; already-migrated connections skip straight past and never
  // contend for the write lock — important under parallel build workers.
  const version = Number(sqlite.pragma("user_version", { simple: true }));
  if (version < SCHEMA_VERSION) {
    applySchema(sqlite);
    sqlite.pragma(`user_version = ${SCHEMA_VERSION}`);
  }
  const d = drizzle(sqlite, { schema });
  const seeded =
    (sqlite.prepare("SELECT COUNT(*) AS n FROM vat_rates").get() as { n: number })
      .n > 0;
  if (!seeded) seedInto(d);
  return d;
}

export const db = global.__cashish_db__ ?? createDb();
if (process.env.NODE_ENV !== "production") global.__cashish_db__ = db;

export { schema };
