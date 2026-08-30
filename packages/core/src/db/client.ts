import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
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
// EVERYTHING HERE IS LAZY, DELIBERATELY. `next build` imports every route module
// to collect its config, so anything this file does at module scope happens
// during the build: a connection, or a thrown "DATABASE_URL is not set", turns a
// build that never queries anything into a build that needs a live database.
// The pool is therefore created on first use, not on import.
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __cashish_pool__: Pool | undefined;
  // eslint-disable-next-line no-var
  var __cashish_db__: NodePgDatabase<typeof schema> | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Local dev expects a Postgres connection string, " +
        "e.g. postgres://cashish:cashish@localhost:5470/cashish_dev",
    );
  }

  // The Neon marketplace integration points Production, Preview AND Development
  // at the same database. That means a preview deployment of any branch would
  // read and WRITE the real books — a pull request could quietly delete an
  // invoice. Refuse instead, loudly, unless someone has deliberately pointed
  // preview at its own database and said so.
  //
  // The right long-term answer is a Neon branch per preview; this guard is what
  // stops the wrong thing happening until that exists.
  if (process.env.VERCEL_ENV === "preview" && !process.env.CASHISH_ALLOW_PREVIEW_DB) {
    throw new Error(
      "Refusing to connect: this is a preview deployment and DATABASE_URL points at " +
        "the shared (production) database, so writes here would change the real books. " +
        "Give preview its own database — a Neon branch — and set " +
        "CASHISH_ALLOW_PREVIEW_DB=1 to confirm.",
    );
  }
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
function getPool(): Pool {
  global.__cashish_pool__ ??= createPool();
  return global.__cashish_pool__;
}

function getDb(): NodePgDatabase<typeof schema> {
  global.__cashish_db__ ??= drizzle(getPool(), { schema });
  return global.__cashish_db__;
}

/**
 * A stand-in that builds the real drizzle client on first property access.
 *
 * The alternative is exporting a getter and writing `getDb().select(...)` at
 * ~400 call sites, which buys nothing: this keeps `db.select(...)` reading
 * exactly as it always has while moving the connection to first query.
 */
export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get: (_target, property, receiver) => Reflect.get(getDb(), property, receiver),
  has: (_target, property) => property in getDb(),
});

/** Lazy too — importing this module must never open a socket. */
export const pool = {
  end: () => (global.__cashish_pool__ ? global.__cashish_pool__.end() : Promise.resolve()),
  query: ((...args: Parameters<Pool["query"]>) =>
    (getPool().query as (...a: unknown[]) => unknown)(...args)) as Pool["query"],
};

export type Db = NodePgDatabase<typeof schema>;

/**
 * Replaces better-sqlite3's `.get()`, which node-postgres has no equivalent for.
 * Always pair with `.limit(1)` at the call site so the database does the work.
 */
export function first<T>(rows: T[]): T | null {
  return rows[0] ?? null;
}

export { schema };
