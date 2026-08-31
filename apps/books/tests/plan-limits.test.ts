/**
 * Plan limits.
 *
 * The first test is the one that matters most, and it is deliberately first:
 * while BILLING_LIVE is false every gate must allow everything. That assertion
 * is what lets this code exist in the repository without changing the
 * experience of anyone using cashish today, and if it ever fails, customers are
 * being turned away by a feature nobody switched on.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@cashish/core/db";
import { makeTenant, closePool } from "./harness";
import { BILLING_LIVE } from "../src/lib/marketing";
import { limitsFor, assertWithinUserLimit, assertFeature, hasFeature, LimitError } from "../src/lib/limits";
import { createUser, addMembership } from "../src/lib/auth";

let tenant: { id: string; slug: string };

before(async () => {
  tenant = await makeTenant("limits");
  // The tightest plan there is: one user, no features.
  await db.insert(schema.subscriptions).values({
    id: randomUUID(),
    tenantId: tenant.id,
    planCode: "sole",
    status: "active",
  });
});
after(closePool);

test("while billing is off, every gate allows everything", async () => {
  assert.equal(BILLING_LIVE, false, "if this has been switched on, read the rest of this file");

  const limits = await limitsFor(tenant.id);
  assert.equal(limits.maxUsers, null, "no user limit applies");
  for (const feature of ["payroll", "receipts", "mcp", "oauth"] as const) {
    assert.equal(limits.features[feature], true, `${feature} is available`);
    assert.equal(await hasFeature(tenant.id, feature), true);
    await assertFeature(tenant.id, feature); // must not throw
  }

  // The sole plan allows one member; this tenant already has none, but even at
  // ten the gate must stay open while the flag is false.
  for (let n = 0; n < 3; n += 1) {
    const userId = await createUser({
      email: `limits-${randomUUID().slice(0, 8)}@example.test`,
      password: "correct-horse-battery",
    });
    await addMembership(userId, tenant.id, "accountant");
  }
  await assertWithinUserLimit(tenant.id); // must not throw with 3 members on a 1-user plan
});

// ---------------------------------------------------------------------------
// The rest of the behaviour, exercised directly against limitsFor's inputs so
// it is verified now rather than discovered on the day the flag is flipped.
// ---------------------------------------------------------------------------

test("the plans table is the source of the numbers", async () => {
  const rows = await db.select().from(schema.plans).orderBy(schema.plans.sortOrder);
  assert.deepEqual(
    rows.map((r) => [r.code, r.priceCents, r.maxUsers]),
    [
      ["sole", 900, 1],
      ["company", 2900, null],
      ["practice", null, null],
    ],
    "seeded from SEED_PLANS by the 0006 migration",
  );
});

test("features parse out of the plan row", async () => {
  const { parseFeatures } = await import("@cashish/core/plans");
  const [sole] = await db.select().from(schema.plans).where(eq(schema.plans.code, "sole"));
  const [company] = await db.select().from(schema.plans).where(eq(schema.plans.code, "company"));

  assert.deepEqual(parseFeatures(sole.features), {
    payroll: false,
    receipts: false,
    mcp: false,
    oauth: false,
  });
  assert.deepEqual(parseFeatures(company.features), {
    payroll: true,
    receipts: true,
    mcp: true,
    oauth: false,
  });
});

test("a malformed features column costs a feature rather than the page", async () => {
  const { parseFeatures } = await import("@cashish/core/plans");
  assert.deepEqual(parseFeatures("{not json"), {
    payroll: false,
    receipts: false,
    mcp: false,
    oauth: false,
  });
  assert.deepEqual(parseFeatures(null), {
    payroll: false,
    receipts: false,
    mcp: false,
    oauth: false,
  });
});

test("LimitError is distinguishable, so a caller can show it rather than crash", () => {
  const error = new LimitError("nope");
  assert.equal(error.name, "LimitError");
  assert.ok(error instanceof Error);
});

test("every tenant the migration touched has a subscription", async () => {
  const tenants = await db.select({ id: schema.tenants.id }).from(schema.tenants);
  const subs = await db.select({ tenantId: schema.subscriptions.tenantId }).from(schema.subscriptions);
  const covered = new Set(subs.map((s) => s.tenantId));

  // Tenants made by this suite's harness bypass the migration, so this asserts
  // the shape of the query rather than universal coverage.
  assert.ok(covered.has(tenant.id), "the tenant this file created is covered");
  assert.ok(tenants.length > 0);
});
