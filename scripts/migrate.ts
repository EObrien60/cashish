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
