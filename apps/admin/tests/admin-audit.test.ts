/**
 * The audit log's one load-bearing property: the record and the change are the
 * same transaction.
 *
 * A log that can be missing the row for a change that happened, or can hold a
 * row for a change that did not, is not evidence of anything.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { ensureSchema, scratchEmail, makeTenant, closePool } from "./harness";
import { createAdmin } from "../src/lib/admin-auth";
import { withAudit, listAudit, auditForSubject } from "../src/lib/audit";

let adminId: string;

before(async () => {
  await ensureSchema();
  adminId = await createAdmin({ email: scratchEmail("audit"), password: "correct-horse-battery" });
});
after(closePool);

test("a mutation and its audit row commit together", async () => {
  const tenant = await makeTenant("commit");
  const { db, schema } = await import("@cashish/core/db");

  await withAudit(
    adminId,
    {
      action: "tenant.rename",
      subjectType: "tenant",
      subjectId: tenant.id,
      tenantId: tenant.id,
      before: { name: `Test commit` },
      after: { name: "Renamed" },
    },
    async (trx) => {
      await trx.update(schema.tenants).set({ name: "Renamed" }).where(eq(schema.tenants.id, tenant.id));
    },
  );

  const [row] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenant.id));
  assert.equal(row.name, "Renamed", "the mutation landed");

  const entries = await auditForSubject("tenant", tenant.id);
  assert.equal(entries.length, 1, "exactly one audit row, not zero and not two");
  assert.equal(entries[0].action, "tenant.rename");
  assert.equal(JSON.parse(entries[0].after!).name, "Renamed");
  assert.equal(JSON.parse(entries[0].before!).name, "Test commit");
});

test("when the mutation throws, neither it nor the audit row survives", async () => {
  const tenant = await makeTenant("rollback");
  const { db, schema } = await import("@cashish/core/db");

  await assert.rejects(() =>
    withAudit(
      adminId,
      { action: "tenant.rename", subjectType: "tenant", subjectId: tenant.id, tenantId: tenant.id },
      async (trx) => {
        await trx.update(schema.tenants).set({ name: "Should not persist" }).where(eq(schema.tenants.id, tenant.id));
        throw new Error("deliberate failure after the write");
      },
    ),
  );

  const [row] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenant.id));
  assert.equal(row.name, "Test rollback", "the mutation must have rolled back");
  assert.equal(
    (await auditForSubject("tenant", tenant.id)).length,
    0,
    "and there must be no audit row claiming it happened",
  );
});

test("the audit row records who did it", async () => {
  const tenant = await makeTenant("who");
  await withAudit(
    adminId,
    { action: "tenant.touch", subjectType: "tenant", subjectId: tenant.id, tenantId: tenant.id },
    async () => {},
  );

  const [entry] = await auditForSubject("tenant", tenant.id);
  assert.match(entry.adminEmail, /^audit-/, "joined back to the administrator who acted");
});

test("an action with no tenant is allowed", async () => {
  await withAudit(
    adminId,
    { action: "plan.update", subjectType: "plan", subjectId: "company", after: { priceCents: 3900 } },
    async () => {},
  );

  const [entry] = await auditForSubject("plan", "company");
  assert.equal(entry.tenantId, null);
  assert.equal(entry.before, null, "a create or an edit with no prior value records null, not '{}'");
});

test("the log reads newest first", async () => {
  const tenant = await makeTenant("order");
  for (const action of ["tenant.a", "tenant.b", "tenant.c"]) {
    await withAudit(
      adminId,
      { action, subjectType: "tenant", subjectId: tenant.id, tenantId: tenant.id },
      async () => {},
    );
  }
  const entries = await auditForSubject("tenant", tenant.id);
  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map((e) => e.action),
    ["tenant.c", "tenant.b", "tenant.a"],
  );
});

test("the audit row outlives the tenant it refers to", async () => {
  const tenant = await makeTenant("outlive");
  const { db, schema } = await import("@cashish/core/db");

  await withAudit(
    adminId,
    {
      action: "tenant.delete",
      subjectType: "tenant",
      subjectId: tenant.id,
      tenantId: tenant.id,
      before: { slug: tenant.slug, transactions: 0 },
    },
    async (trx) => {
      await trx.delete(schema.tenants).where(eq(schema.tenants.id, tenant.id));
    },
  );

  assert.equal(
    (await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenant.id))).length,
    0,
    "the tenant is gone",
  );
  const [entry] = await auditForSubject("tenant", tenant.id);
  assert.ok(entry, "but the record of deleting it is not — no cascade on audit.tenant_id");
  assert.equal(JSON.parse(entry.before!).slug, tenant.slug);
});

test("listAudit returns rows across subjects", async () => {
  assert.ok((await listAudit(500)).length > 0);
});
