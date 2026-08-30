/**
 * Applies pending drizzle migrations. Run by the Vercel build before `next
 * build`, by hand in dev, and by the test harness. Nothing applies schema at
 * request time.
 *
 * Wrapped in a Postgres advisory lock, because more than one migrator can
 * genuinely start at once: two deployments building concurrently, or the test
 * suite, where every test file runs in its own process and each ensures the
 * schema. Without the lock they race on the migrations table and most of them
 * fail. With it, the first wins and the rest wait and then find nothing to do.
 */
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate as runMigrations } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";

/** Any stable 64-bit key; this one is just "cashish migrations". */
const LOCK_KEY = 8_142_539_071_004_311n;

/**
 * Resolved against this module, never the working directory.
 *
 * The migrations now live in a package that is run from two applications, from
 * the CLI and from the test harness, each with a different cwd. Drizzle treats
 * a migrations folder that does not exist as "nothing pending" — so a
 * cwd-relative path would not throw, it would report success and apply nothing.
 */
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

export async function migrate(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");

  // This opens its own pool, so it does not inherit the preview guard in
  // client.ts. Without the same check here, a preview BUILD would migrate the
  // production database — the one thing a preview must never touch.
  if (process.env.VERCEL_ENV === "preview" && !process.env.CASHISH_ALLOW_PREVIEW_DB) {
    console.log(
      "preview deployment: skipping migrations, since DATABASE_URL points at the shared " +
        "(production) database. Set CASHISH_ALLOW_PREVIEW_DB=1 once preview has its own.",
    );
    return;
  }

  const pool = new Pool({
    connectionString,
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: true },
    // One connection: the lock is held on a session, so it must be the same one.
    max: 1,
  });
  const db = drizzle(pool);
  const target = connectionString.replace(/:[^:@/]+@/, ":***@");

  await db.execute(sql`select pg_advisory_lock(${LOCK_KEY})`);
  try {
    console.log(`migrating ${target}`);
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log("migrations applied");
  } finally {
    await db.execute(sql`select pg_advisory_unlock(${LOCK_KEY})`);
    await pool.end();
  }
}
