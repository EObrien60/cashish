/**
 * Test harness.
 *
 * Runs against real Postgres, because that is what production runs. The old
 * suite ran on SQLite while the app now ships on Postgres, and testing one
 * engine while shipping another is how a rounding or boolean bug reaches the
 * books unnoticed.
 *
 * Each test file gets its own tenant, so nothing has to coordinate cleanup and
 * two files can run without seeing each other's rows.
 */
import { runInTenant } from "@cashish/core/db";
import { migrate } from "@cashish/core/migrate";
import type { Role } from "@cashish/core/rbac";

const url = process.env.DATABASE_URL ?? "";
if (!/test/i.test(url)) {
  throw new Error(
    `refusing to run against ${url || "the default database"} — DATABASE_URL must name a test database`,
  );
}

let migrated = false;

/**
 * Applies migrations once per process.
 *
 * Calls the migrator directly rather than spawning `tsx scripts/migrate.ts`.
 * The script used to be a sibling of this file; it now lives in @cashish/core,
 * and a subprocess would have to guess at a path relative to whichever working
 * directory the runner happened to use. The advisory lock inside migrate() is
 * what makes concurrent test files safe, and it works the same either way.
 */
export async function ensureSchema() {
  if (migrated) return;
  await migrate();
  migrated = true;
}

export async function makeTenant(label: string) {
  await ensureSchema();
  const { createTenant } = await import("../src/db/seed");
  const { uid } = await import("../src/lib/id");
  const slug = `test-${label}-${uid().slice(0, 8)}`;
  const id = await createTenant({ slug, name: `Test ${label}` });
  return { id, slug };
}

/** Runs fn inside a tenant context, as a given role. */
export function asTenant<T>(tenantId: string, fn: () => Promise<T>, role: Role = "owner") {
  return runInTenant({ tenantId, role, actor: "test" }, fn);
}

/** Ids the seed gives every tenant, namespaced. */
export const seeded = (tenantId: string, baseId: string) => `${tenantId}:${baseId}`;

export async function closePool() {
  const { pool } = await import("@cashish/core/db");
  await pool.end();
}
