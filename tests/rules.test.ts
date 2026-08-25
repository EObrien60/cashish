/**
 * Rule application.
 *
 * The behaviour that matters: changing a rule and re-applying has to reach transactions
 * that already have a category, or correcting a rule silently does nothing to the
 * history it was meant to fix.
 *
 *   npm test
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { asTenant, makeTenant, seeded, closePool } from "./harness";
import { db, schema } from "../src/db/client";
import { and, eq } from "drizzle-orm";
import { saveRule, listRules, deleteRule, applyRulesToUncategorized, applyRulesToAll } from "../src/lib/rules";
import { createInvoice, nextInvoiceNumber } from "../src/lib/invoices";
import { createCustomer } from "../src/lib/customers";
import { uid } from "../src/lib/id";

let tenant: string;
const cat = (base: string) => seeded(tenant, base);

before(async () => {
  tenant = (await makeTenant("rules")).id;
});
after(closePool);

const reset = () =>
  asTenant(tenant, async () => {
    await db.delete(schema.transactions).where(eq(schema.transactions.tenantId, tenant));
    for (const rule of await listRules()) await deleteRule(rule.id);
  });

const addTx = (description: string, categoryId: string | null = null) =>
  asTenant(tenant, async () => {
    const id = uid();
    await db.insert(schema.transactions).values({
      id,
      tenantId: tenant,
      bookedDate: "2026-07-01",
      amount: -10,
      description,
      categoryId,
      importBatch: uid(),
    });
    return id;
  });

const categoryOf = (id: string) =>
  asTenant(tenant, async () => {
    const [row] = await db
      .select()
      .from(schema.transactions)
      .where(and(eq(schema.transactions.tenantId, tenant), eq(schema.transactions.id, id)))
      .limit(1);
    return row?.categoryId ?? null;
  });

const hetzner = (categoryId: string, enabled = true) => ({
  name: "Hetzner",
  matchField: "description",
  matchType: "contains",
  matchValue: "HETZNER",
  direction: "any",
  categoryId,
  vatRateId: null,
  enabled,
});

test("re-applying a corrected rule reaches transactions that already have a category", async () => {
  await reset();
  // The scenario: a rule put these under the wrong category, and the rule is now fixed.
  const wrong = await addTx("HETZNER ONLINE GMBH", cat("cat-misc"));
  await asTenant(tenant, () => saveRule(hetzner(cat("cat-software"))));

  // Applying to uncategorised only leaves the mistake in place — which is the bug.
  await asTenant(tenant, () => applyRulesToUncategorized());
  assert.equal(await categoryOf(wrong), cat("cat-misc"), "an already-categorised row is not reached");

  const result = await asTenant(tenant, () => applyRulesToAll());
  assert.equal(await categoryOf(wrong), cat("cat-software"), "re-applying must correct it");
  assert.equal(result.updated, 1);
  assert.equal(result.recategorised, 1, "reported separately, because it overwrote something");
});

test("a category no rule matches is left alone", async () => {
  await reset();
  // Categorised by hand, and no rule has an opinion about it. It must survive.
  const manual = await addTx("SOMETHING ONLY A HUMAN UNDERSTOOD", cat("cat-professional"));
  const ruled = await addTx("HETZNER ONLINE GMBH");
  await asTenant(tenant, () => saveRule(hetzner(cat("cat-software"))));

  const result = await asTenant(tenant, () => applyRulesToAll());
  assert.equal(await categoryOf(manual), cat("cat-professional"), "no rule matched it, so nothing touched it");
  assert.equal(await categoryOf(ruled), cat("cat-software"));
  assert.equal(result.updated, 1);
  assert.equal(result.recategorised, 0, "nothing was overwritten");
});

test("a disabled rule stops claiming transactions", async () => {
  await reset();
  const tx = await addTx("HETZNER ONLINE GMBH", cat("cat-software"));
  await asTenant(tenant, () => saveRule(hetzner(cat("cat-software"), false)));

  const result = await asTenant(tenant, () => applyRulesToAll());
  assert.equal(result.updated, 0);
  assert.equal(await categoryOf(tx), cat("cat-software"), "disabling a rule does not clear what it set");
});

test("a historic invoice keeps its own number and leaves the sequence alone", async () => {
  await asTenant(tenant, async () => {
    const { customer } = await createCustomer({ name: `Numbering Test ${uid()}` });
    const before = await nextInvoiceNumber();

    // Copied in from another system: the number on the document the customer holds.
    const historic = await createInvoice({
      customerId: customer.id,
      number: "1010",
      status: "sent",
      issueDate: "2026-03-27",
      lines: [{ description: "Contract work", quantity: 1, unitPrice: 5000, vatRateId: null, productId: null }],
    });
    assert.equal(historic?.number, "1010");
    assert.equal(await nextInvoiceNumber(), before, "importing history must not push the next number forward");

    // A new invoice still takes the next in sequence.
    const fresh = await createInvoice({
      customerId: customer.id,
      status: "draft",
      issueDate: "2026-08-24",
      lines: [{ description: "New work", quantity: 1, unitPrice: 100, vatRateId: null, productId: null }],
    });
    assert.equal(fresh?.number, before);
    assert.notEqual(await nextInvoiceNumber(), before, "and that one does consume it");
  });
});
