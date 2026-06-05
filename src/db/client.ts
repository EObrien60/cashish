import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { applySchema } from "./migrate";
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

function tableExists(sqlite: Database.Database, name: string): boolean {
  const row = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
  return !!row;
}

function createDb() {
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 10000");
  sqlite.pragma("foreign_keys = ON");

  // Only ever WRITE when initialisation is actually needed. Under parallel
  // build workers, gating on cheap reads means an already-initialised DB takes
  // the read-only path and never contends for the write lock.
  if (!tableExists(sqlite, "settings")) {
    applySchema(sqlite);
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
