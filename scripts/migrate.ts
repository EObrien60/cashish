#!/usr/bin/env tsx
/**
 * Applies pending drizzle migrations. Run by the Vercel build before `next
 * build`, and by hand in dev. Nothing applies schema at request time.
 */
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

// This script opens its own pool, so it does not inherit the preview guard in
// src/db/client.ts. Without the same check here, a preview BUILD would migrate
// the production database — the one thing a preview must never touch.
if (process.env.VERCEL_ENV === "preview" && !process.env.CASHISH_ALLOW_PREVIEW_DB) {
  console.log(
    "preview deployment: skipping migrations, since DATABASE_URL points at the shared " +
      "(production) database. Set CASHISH_ALLOW_PREVIEW_DB=1 once preview has its own.",
  );
  process.exit(0);
}

async function main() {
  const pool = new Pool({
    connectionString,
    ssl: /localhost|127\.0\.0\.1/.test(connectionString!) ? false : { rejectUnauthorized: true },
  });
  const db = drizzle(pool);
  const target = connectionString!.replace(/:[^:@/]+@/, ":***@");
  console.log(`migrating ${target}`);
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("migrations applied");
  await pool.end();
}

main().catch((error) => {
  console.error("migration failed:", error);
  process.exit(1);
});
