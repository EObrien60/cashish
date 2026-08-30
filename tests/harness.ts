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
import { execFileSync } from "node:child_process";
import { runInTenant } from "../src/db/context";
import type { Role } from "../src/lib/rbac";

const url = process.env.DATABASE_URL ?? "";
if (!/test/i.test(url)) {
  throw new Error(
    `refusing to run against ${url || "the default database"} — DATABASE_URL must name a test database`,
  );
}

let migrated = false;

/** Applies migrations once per process. */
export function ensureSchema() {
  if (migrated) return;
  execFileSync("npx", ["tsx", "scripts/migrate.ts"], {
    stdio: "pipe",
    env: process.env,
  });
  migrated = true;
}

export async function makeTenant(label: string) {
  ensureSchema();
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
  const { pool } = await import("../src/db/client");
  await pool.end();
}
