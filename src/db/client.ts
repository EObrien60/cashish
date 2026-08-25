import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

// ---------------------------------------------------------------------------
// Single point of DB coupling. The rest of the app imports `db` and `schema`
// only.
//
// `pg` over TCP+TLS rather than @neondatabase/serverless: the same driver then
// reaches Neon's pooled endpoint in production and a plain Postgres container
// in dev and test, so there is exactly one dialect and one driver everywhere.
// (neon-serverless speaks WebSockets and needs a proxy to reach local Postgres.)
//
// Schema is applied by migrations (`npm run db:migrate`), never at request time.
// Seeding is per tenant, at tenant creation — see seedTenant().
//
// The pool is module-scoped: Vercel Fluid Compute reuses instances across
// concurrent requests, so this is created once per instance, not per request.
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Local dev expects a Postgres connection string, " +
      "e.g. postgres://cashish:cashish@localhost:5470/cashish_dev",
  );
}
// Bound to a const the compiler knows is a string; the guard above does not
// narrow process.env inside the closure below.
const connectionString: string = DATABASE_URL;

declare global {
  // eslint-disable-next-line no-var
  var __cashish_pool__: Pool | undefined;
}

function createPool() {
  return new Pool({
    connectionString,
    // Neon terminates idle connections; keep the pool small and let it recycle.
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // Neon requires TLS; a local container does not offer it.
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: true },
  });
}

// Reused across HMR reloads in dev so `next dev` does not leak a pool per edit.
const pool = global.__cashish_pool__ ?? createPool();
if (process.env.NODE_ENV !== "production") global.__cashish_pool__ = pool;

export const db = drizzle(pool, { schema });

/**
 * Replaces better-sqlite3's `.get()`, which node-postgres has no equivalent for.
 * Always pair with `.limit(1)` at the call site so the database does the work.
 */
export function first<T>(rows: T[]): T | null {
  return rows[0] ?? null;
}
export type Db = typeof db;
export { pool, schema };
