/**
 * Admin test harness.
 *
 * Unlike the books harness there is no tenant to establish: these tests are
 * about the platform, and the queries under test run deliberately outside
 * runInTenant. What this does provide is a distinct ADMIN_AUTH_SECRET, because
 * the module refuses to load with one that matches AUTH_SECRET, and that
 * refusal is itself one of the things under test.
 */
import { randomUUID } from "node:crypto";
import { migrate } from "@cashish/core/migrate";

const url = process.env.DATABASE_URL ?? "";
if (!/test/i.test(url)) {
  throw new Error(
    `refusing to run against ${url || "the default database"} — DATABASE_URL must name a test database`,
  );
}

export const BOOKS_SECRET = "books-secret-for-tests-0000000000000000";
export const ADMIN_SECRET = "admin-secret-for-tests-1111111111111111";

process.env.AUTH_SECRET ??= BOOKS_SECRET;
process.env.ADMIN_AUTH_SECRET ??= ADMIN_SECRET;

let migrated = false;

export async function ensureSchema() {
  if (migrated) return;
  await migrate();
  migrated = true;
}

/** A unique address per call, so files can run without colliding. */
export const scratchEmail = (label: string) =>
  `${label}-${randomUUID().slice(0, 8)}@example.test`;

export async function makeTenant(label: string) {
  await ensureSchema();
  const { db, schema } = await import("@cashish/core/db");
  const id = randomUUID();
  const slug = `admtest-${label}-${id.slice(0, 8)}`;
  await db.insert(schema.tenants).values({ id, slug, name: `Test ${label}` });
  return { id, slug };
}

export async function makeUser(email: string, name = "Test Person") {
  await ensureSchema();
  const { db, schema } = await import("@cashish/core/db");
  const { hashPassword } = await import("../src/lib/admin-auth");
  const id = randomUUID();
  await db.insert(schema.users).values({
    id,
    email,
    passwordHash: await hashPassword("not-used-in-these-tests"),
    name,
  });
  return id;
}

export async function closePool() {
  const { pool } = await import("@cashish/core/db");
  await pool.end();
}
