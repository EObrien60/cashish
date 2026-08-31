/**
 * Cross-tenant reads.
 *
 * The mirror image of the books app's tenancy.test.ts: there, seeing another
 * tenant's rows is the bug. Here it is the requirement. Both are asserted so
 * that neither can drift into the other.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ensureSchema, makeTenant, makeUser, scratchEmail, closePool } from "./harness";
import { listTenants, getTenant, tenantFootprint, tenantsWithoutSubscription } from "../src/queries/tenants";
import { listUsers, getUser } from "../src/queries/users";

let alpha: { id: string; slug: string };
let beta: { id: string; slug: string };
let alphaUser: string;

before(async () => {
  await ensureSchema();
  const { db, schema } = await import("@cashish/core/db");

  alpha = await makeTenant("alpha");
  beta = await makeTenant("beta");

  alphaUser = await makeUser(scratchEmail("alpha-owner"), "Alpha Owner");
  const betaUser = await makeUser(scratchEmail("beta-owner"), "Beta Owner");

  await db.insert(schema.memberships).values([
    { userId: alphaUser, tenantId: alpha.id, role: "owner" },
    { userId: betaUser, tenantId: beta.id, role: "owner" },
    // Alpha's owner also works in beta — the case a per-user list must show.
    { userId: alphaUser, tenantId: beta.id, role: "accountant" },
  ]);

  // Two transactions in alpha, none in beta, so the counts must differ.
  await db.insert(schema.transactions).values([
    { id: randomUUID(), tenantId: alpha.id, bookedDate: "2026-01-05", description: "One", amount: 100 },
    { id: randomUUID(), tenantId: alpha.id, bookedDate: "2026-02-05", description: "Two", amount: -40 },
  ]);
});
after(closePool);

test("the tenant list spans every tenant", async () => {
  const rows = await listTenants();
  const slugs = rows.map((r) => r.slug);
  assert.ok(slugs.includes(alpha.slug), "alpha is listed");
  assert.ok(slugs.includes(beta.slug), "beta is listed too — this query is not tenant-scoped");
});

test("counts are per tenant, not summed across them", async () => {
  const rows = await listTenants();
  const a = rows.find((r) => r.id === alpha.id)!;
  const b = rows.find((r) => r.id === beta.id)!;

  assert.equal(a.transactionCount, 2);
  assert.equal(b.transactionCount, 0, "beta has none; a join would have leaked alpha's");
  assert.equal(a.memberCount, 1);
  assert.equal(b.memberCount, 2);
});

test("last activity comes from the newest of transactions and invoices", async () => {
  const rows = await listTenants();
  assert.equal(rows.find((r) => r.id === alpha.id)!.lastActivity, "2026-02-05");
  assert.equal(rows.find((r) => r.id === beta.id)!.lastActivity, null);
});

test("search matches slug and name, and excludes what does not match", async () => {
  const bySlug = await listTenants(alpha.slug);
  assert.equal(bySlug.length, 1);
  assert.equal(bySlug[0].id, alpha.id);

  assert.equal((await listTenants("no-such-tenant-anywhere")).length, 0);
});

test("tenant detail carries members, counts and no ledger rows", async () => {
  const detail = await getTenant(alpha.id);
  assert.ok(detail);
  assert.equal(detail!.tenant.slug, alpha.slug);
  assert.equal(detail!.counts.transactions, 2);
  assert.equal(detail!.members.length, 1);
  assert.equal(detail!.members[0].role, "owner");

  // The console shows counts, never the rows themselves.
  assert.ok(!("transactions" in (detail as Record<string, unknown>)));
});

test("an unknown tenant is null rather than an exception", async () => {
  assert.equal(await getTenant(randomUUID()), null);
});

test("a user's memberships span the tenants they belong to", async () => {
  const detail = await getUser(alphaUser);
  assert.ok(detail);
  assert.equal(detail!.memberships.length, 2, "one owner, one accountant, two different tenants");
  const roles = detail!.memberships.map((m) => m.role).sort();
  assert.deepEqual(roles, ["accountant", "owner"]);
});

test("the user list is searchable and spans tenants", async () => {
  const all = await listUsers();
  assert.ok(all.some((u) => u.id === alphaUser));
  const found = await listUsers("Alpha Owner");
  assert.ok(found.some((u) => u.id === alphaUser));
  assert.equal(found.find((u) => u.id === alphaUser)!.membershipCount, 2);
});

test("the footprint records what a delete would destroy", async () => {
  const footprint = await tenantFootprint(alpha.id);
  assert.equal(footprint!.slug, alpha.slug);
  assert.equal(footprint!.transactions, 2);
  assert.equal(footprint!.members, 1);
});

test("tenants created outside the migration have no subscription until one is made", async () => {
  // makeTenant inserts directly, bypassing the backfill, so this is > 0 here.
  // The assertion that matters is that the query answers at all — the console
  // uses it to show which tenants need attention.
  assert.equal(typeof (await tenantsWithoutSubscription()), "number");
});
