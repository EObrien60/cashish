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
import { db, schema } from "@cashish/core/db";
import { and, eq, isNull } from "drizzle-orm";
import { saveRule, listRules, deleteRule, acceptRule, applyRulesToUncategorized, applyRulesToAll } from "../src/lib/rules";
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

/**
 * Accepting a suggested rule.
 *
 * The proposal path built its own rule object and set `applyNow: "uncategorised"`,
 * which is not a column. Drizzle drops an unknown key without a word, so the
 * rule was created and nothing was ever categorised — which, from the ledger,
 * looks exactly like the rule not having been created at all.
 */
test("accepting a suggested rule categorises what it matches", async () => {
  await reset();
  const lidl = await addTx("LIDL 4471 GALWAY");
  const other = await addTx("SOMETHING ELSE ENTIRELY");

  const applied = await asTenant(tenant, () =>
    acceptRule({
      name: "Lidl",
      matchValue: "Lidl",
      direction: "out",
      categoryId: cat("cat-misc"),
    }),
  );

  const rules = await asTenant(tenant, listRules);
  assert.ok(rules.some((r) => r.matchValue === "Lidl"), "the rule should exist");
  assert.equal(applied.updated, 1);
  assert.equal(await categoryOf(lidl), cat("cat-misc"), "the rule must reach the ledger");
  assert.equal(await categoryOf(other), null, "and must not reach anything else");
});

/**
 * Applying rules used to be one UPDATE per matching row. A broad rule on a real
 * book is a thousand-plus sequential round-trips, which is why "apply rules"
 * stopped coming back. Rows are grouped by the rule that claims them now, so
 * this asserts the counts still hold across more rows than fit in one statement.
 */
test("a rule matching many rows applies to all of them", async () => {
  await reset();
  await asTenant(tenant, async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({
      id: uid(),
      tenantId: tenant,
      bookedDate: "2026-07-01",
      amount: -10,
      description: `LIDL 4471 GALWAY ${i}`,
      importBatch: uid(),
    }));
    await db.insert(schema.transactions).values(rows);
  });

  const applied = await asTenant(tenant, () =>
    acceptRule({ name: "Lidl", matchValue: "LIDL", direction: "out", categoryId: cat("cat-misc") }),
  );
  assert.equal(applied.updated, 250);

  const left = await asTenant(tenant, () =>
    db
      .select()
      .from(schema.transactions)
      .where(and(eq(schema.transactions.tenantId, tenant), isNull(schema.transactions.categoryId))),
  );
  assert.equal(left.length, 0, "every matching row should be categorised");

  // And the rule's own counter reflects the whole set, not one statement's worth.
  const [rule] = await asTenant(tenant, listRules);
  assert.equal(rule.timesApplied, 250);
});
