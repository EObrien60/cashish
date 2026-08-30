/**
 * Posting kinds on rules.
 *
 * The point of the kind is that it makes an unattributed rule unrepresentable:
 * a rule that says "payment to a supplier" cannot be saved without naming the
 * supplier. That is the guarantee these tests defend, along with the two things
 * that went wrong building it.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { eq, and } from "drizzle-orm";
import { asTenant, makeTenant, seeded, closePool } from "./harness";
import { db, schema } from "../src/db/client";
import { uid } from "../src/lib/id";
import { saveRule, listRules, applyRulesToAll, RulePostingError } from "../src/lib/rules";
import { listTransactions, transactionCounts } from "../src/lib/transactions";
import { createVendor } from "../src/lib/vendors";
import { createCustomer } from "../src/lib/customers";
import { createPerson } from "../src/lib/people";
import {
  validatePosting,
  normalisePosting,
  POSTING_SPECS,
  describePosting,
} from "../src/lib/posting";

let t: string;
const cat = (base: string) => seeded(t, base);

before(async () => {
  t = (await makeTenant("posting")).id;
});
after(closePool);

const tx = (amount: number, date: string, description: string, categoryId: string | null = null) =>
  asTenant(t, async () => {
    const id = uid();
    await db.insert(schema.transactions).values({
      id,
      tenantId: t,
      bookedDate: date,
      amount,
      description,
      categoryId,
      importBatch: uid(),
    });
    return id;
  });

const base = {
  name: "r",
  matchField: "description",
  matchType: "contains",
  direction: "any",
  vatRateId: null,
  enabled: true,
};

test("a kind requires its counterparty, so an unattributed rule cannot be saved", async () => {
  await asTenant(t, async () => {
    for (const [posting, expected] of [
      ["vendor_payment", /needs the vendor named/],
      ["payroll", /needs that person named/],
      ["sales_receipt", /needs the customer named/],
      ["tax", /which tax/],
    ] as const) {
      await assert.rejects(
        () =>
          saveRule({
            ...base,
            matchValue: `MISSING-${posting}`,
            categoryId: cat("cat-misc"),
            posting,
          }),
        RulePostingError,
        `${posting} must refuse to save unattributed`,
      );
    }
    // "other" and "transfer" require nothing, which is what makes them the
    // safe landing places.
    await saveRule({ ...base, matchValue: "PLAIN", categoryId: cat("cat-misc"), posting: "other" });
    await saveRule({ ...base, matchValue: "MOVE", categoryId: null, posting: "transfer" });
    const saved = await listRules();
    assert.ok(saved.some((r) => r.matchValue === "PLAIN" && r.posting === "other"));
    assert.ok(saved.some((r) => r.matchValue === "MOVE" && r.posting === "transfer"));
  });
});

test("a kind that implies a direction refuses to contradict it", () => {
  assert.match(
    validatePosting({ posting: "sales_receipt", customerId: "c1", direction: "out" }) ?? "",
    /only apply to money in/,
  );
  assert.match(
    validatePosting({ posting: "vendor_payment", vendorId: "v1", direction: "in" }) ?? "",
    /only apply to money out/,
  );
  assert.equal(validatePosting({ posting: "sales_receipt", customerId: "c1", direction: "in" }), null);
  // And saving fixes the direction rather than leaving it as "any".
  assert.equal(
    normalisePosting({ posting: "vendor_payment", vendorId: "v1", direction: "any" }).direction,
    "out",
  );
});

test("normalising never deletes a reference the kind does not require", () => {
  // The first version stripped these, which silently broke every existing rule
  // carrying an employee or a vendor without a declared kind.
  const kept = normalisePosting({
    posting: "other",
    vendorId: "v1",
    employeeId: "e1",
    customerId: "c1",
  });
  assert.equal(kept.vendorId, "v1");
  assert.equal(kept.employeeId, "e1");
  assert.equal(kept.customerId, "c1");

  // Revenue Commissioners is legitimately both a tax and a payee, so a tax rule
  // must be able to keep its vendor.
  const taxRule = normalisePosting({ posting: "tax", taxKind: "vat", vendorId: "revenue" });
  assert.equal(taxRule.vendorId, "revenue", "a tax rule keeps its vendor");

  // A transfer is counted nowhere, so the category does go.
  const moved = normalisePosting({ posting: "transfer", categoryId: "cat-misc" });
  assert.equal(moved.categoryId, null);
});

test("a transfer rule excludes what it matches — which rules could not do before", async () => {
  const potOut = await tx(-500, "2026-05-01", "To Tax");
  const potIn = await tx(500, "2026-05-02", "From Tax");
  const real = await tx(-120, "2026-05-03", "GENUINE EXPENSE");

  await asTenant(t, async () => {
    await saveRule({
      ...base,
      name: "own tax pot",
      matchValue: "Tax",
      matchField: "description",
      categoryId: null,
      posting: "transfer",
      excludedReason: "transfer to own tax pot",
    });
    await applyRulesToAll();

    const all = await listTransactions({ excluded: "all" });
    const byId = new Map(all.map((x) => [x.id, x]));
    assert.equal(byId.get(potOut)!.excluded, true, "money into the pot is out of the books");
    assert.equal(byId.get(potIn)!.excluded, true, "and money back out of it");
    assert.equal(byId.get(potOut)!.excludedReason, "transfer to own tax pot");
    assert.equal(byId.get(potOut)!.categoryId, null, "the category goes with it");
    assert.equal(byId.get(real)!.excluded, false, "a genuine expense is untouched");

    const counts = await transactionCounts();
    assert.equal(counts.excluded, 2);
  });
});

test("a transfer rule reaches rows something has already categorised", async () => {
  // The correction case: it was booked as an expense, and it should not have been.
  const wrong = await tx(-800, "2026-06-01", "To Payrolltax", null);
  await asTenant(t, async () => {
    await db
      .update(schema.transactions)
      .set({ categoryId: cat("cat-misc") })
      .where(and(eq(schema.transactions.tenantId, t), eq(schema.transactions.id, wrong)));

    await saveRule({
      ...base,
      name: "own payroll pot",
      matchValue: "Payrolltax",
      categoryId: null,
      posting: "transfer",
      excludedReason: "transfer to own payroll-tax pot",
    });
    // Even the conservative sweep must reach it: taking money out of the books
    // is a correction, most often needed on a row already categorised.
    await applyRulesToAll();

    const row = (await listTransactions({ excluded: "only" })).find((x) => x.id === wrong);
    assert.ok(row, "the miscategorised transfer is now excluded");
    assert.equal(row!.categoryId, null);
  });
});

test("applying a kind attributes the counterparty it names", async () => {
  const paid = await tx(-1000, "2026-07-01", "ACME SUPPLIES LTD");
  const got = await tx(2000, "2026-07-02", "From BIG CLIENT");
  const wages = await tx(-1500, "2026-07-03", "To Dana Quinn");

  await asTenant(t, async () => {
    const vendor = (await createVendor({ name: "Acme Supplies" })).vendor;
    const customer = (await createCustomer({ name: "Big Client" })).customer;
    const person = (await createPerson({ name: "Dana Quinn" })).employee;

    await saveRule({ ...base, name: "acme", matchValue: "ACME SUPPLIES", categoryId: cat("cat-cogs"), posting: "vendor_payment", vendorId: vendor.id });
    await saveRule({ ...base, name: "big", matchValue: "BIG CLIENT", categoryId: cat("cat-sales"), posting: "sales_receipt", customerId: customer.id });
    await saveRule({ ...base, name: "dana", matchValue: "Dana Quinn", categoryId: cat("cat-wages"), posting: "payroll", employeeId: person.id });
    await applyRulesToAll();

    const byId = new Map((await listTransactions({ excluded: "all" })).map((x) => [x.id, x]));
    assert.equal(byId.get(paid)!.vendorId, vendor.id);
    assert.equal(byId.get(got)!.customerId, customer.id, "money in now attributes to a customer too");
    assert.equal(byId.get(wages)!.employeeId, person.id);
  });
});

test("each kind describes itself for the rules list", () => {
  assert.equal(describePosting("vendor_payment", { vendor: "Acme" }), "Paid to Acme");
  assert.equal(describePosting("sales_receipt", { customer: "Big Client" }), "Money in from Big Client");
  assert.equal(describePosting("tax", { taxKind: "vat" }), "Tax · VAT");
  assert.equal(describePosting("transfer", {}), "Internal transfer — counted nowhere");
  assert.equal(describePosting("other", {}), "Categorise only");
  // Every kind has a spec, so the UI cannot meet one it has no copy for.
  for (const id of Object.keys(POSTING_SPECS)) {
    assert.ok(POSTING_SPECS[id as keyof typeof POSTING_SPECS].label.length > 0);
  }
});
