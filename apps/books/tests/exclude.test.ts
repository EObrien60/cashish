/**
 * Excluding transactions.
 *
 * The promise is "counted nowhere". That is only true if every number in the app agrees,
 * so this checks the actual reports rather than just the list.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import { asTenant, makeTenant, seeded, closePool } from "./harness";
import { db, schema } from "@cashish/core/db";
import { listTransactions, setExcluded, transactionCounts } from "../src/lib/transactions";
import { profitAndLoss } from "../src/lib/reports";
import { computeVatReturn } from "../src/lib/vat";
import { reconcileReport } from "../src/lib/reconcile";
import { buildIntegrationSummary } from "../src/lib/integration";
import { uid } from "../src/lib/id";

let tenant: string;
const cat = (base: string) => seeded(tenant, base);

before(async () => {
  tenant = (await makeTenant("exclude")).id;
});
after(closePool);

const clear = () =>
  asTenant(tenant, () =>
    db.delete(schema.transactions).where(eq(schema.transactions.tenantId, tenant)),
  );

const addTx = (description: string, amount: number, categoryId: string | null = null) =>
  asTenant(tenant, async () => {
    const id = uid();
    await db.insert(schema.transactions).values({
      id,
      tenantId: tenant,
      bookedDate: "2026-07-15",
      amount,
      description,
      categoryId,
      importBatch: uid(),
    });
    return id;
  });

test("an excluded transaction is counted nowhere", async () => {
  await clear();
  const kept = await addTx("REAL CLIENT PAYMENT", 1000, cat("cat-sales"));
  const potTransfer = await addTx("To VAT", -500, cat("cat-tax"));

  await asTenant(tenant, async () => {
    const before = await profitAndLoss("2026-07-01", "2026-07-31");
    assert.equal(before.totalIncome, 1000);
    assert.equal(before.totalExpense, 500, "the transfer is counted as an expense to begin with");

    await setExcluded([potTransfer], true, "internal pot transfer, not an expense");

    const after = await profitAndLoss("2026-07-01", "2026-07-31");
    assert.equal(after.totalIncome, 1000, "income is untouched");
    assert.equal(after.totalExpense, 0, "the excluded transfer is out of the P&L");
    assert.equal(after.net, 1000);

    // Out of the list by default, and its own tab shows it.
    assert.deepEqual((await listTransactions()).map((t) => t.id), [kept]);
    assert.deepEqual((await listTransactions({ excluded: "only" })).map((t) => t.id), [potTransfer]);
    assert.equal(
      (await listTransactions({ excluded: "all" })).length,
      2,
      "reconciling a statement needs every line",
    );

    const counts = await transactionCounts();
    assert.deepEqual(counts, { included: 1, excluded: 1, uncategorised: 0 });

    // And excluding cleared the category, because it is out of the books entirely.
    const row = (await listTransactions({ excluded: "only" }))[0];
    assert.equal(row?.categoryId, null);
    assert.equal(row?.excludedReason, "internal pot transfer, not an expense");
  });
});

test("an excluded inflow is not money waiting to be invoiced", async () => {
  await clear();
  const own = await addTx("From VAT", 700);

  await asTenant(tenant, async () => {
    assert.equal((await reconcileReport()).unmatchedInflows, 1, "it looks like unexplained money at first");
    assert.equal((await buildIntegrationSummary("2026-08-24")).bank.unmatchedInflowCount, 1);

    await setExcluded([own], true, "money coming back from our own VAT pot");

    assert.equal((await reconcileReport()).unmatchedInflows, 0, "not an inflow needing an invoice");
    const summary = await buildIntegrationSummary("2026-08-24");
    assert.equal(summary.bank.unmatchedInflowCount, 0, "and Lunar is not told about it either");
    assert.equal(summary.bank.unmatchedInflowTotal, 0);
  });
});

test("excluding is reversible and leaves the row in place", async () => {
  await clear();
  const id = await addTx("MAYBE A MISTAKE", -42);

  await asTenant(tenant, async () => {
    await setExcluded([id], true, "wrong card");
    assert.equal((await transactionCounts()).excluded, 1);

    await setExcluded([id], false);
    const counts = await transactionCounts();
    assert.equal(counts.excluded, 0);
    assert.equal(counts.included, 1, "the row was never deleted");
    assert.equal(
      (await listTransactions())[0]?.excludedReason,
      "",
      "the stale reason is cleared with the flag",
    );
  });
});

test("VAT ignores excluded transactions", async () => {
  await clear();
  const purchase = await addTx("SOME SUPPLIER", -1230, cat("cat-software"));

  await asTenant(tenant, async () => {
    await db
      .update(schema.transactions)
      .set({ vatRateId: cat("vat-standard") })
      .where(eq(schema.transactions.tenantId, tenant));

    const before = await computeVatReturn("2026-07-01", "2026-09-30");
    await setExcluded([purchase], true, "personal");
    const after = await computeVatReturn("2026-07-01", "2026-09-30");

    assert.notEqual(before.t2_purchasesVat, 0, "it was reclaimable to begin with");
    assert.equal(after.t2_purchasesVat, 0, "and now it is not");
    assert.equal(after.netPurchases, 0);
  });
});

test("counts report rows actually changed, not ids asked about", async () => {
  await clear();
  const real = await addTx("A REAL LINE", -10);

  await asTenant(tenant, async () => {
    // A transaction id that does not exist, alongside one that does.
    const result = await setExcluded([real, "no-such-transaction"], true, "mixed batch");
    assert.equal(
      result.updated,
      1,
      "an id that matches nothing must not be counted as work done — an agent acts on this number",
    );
    assert.equal((await transactionCounts()).excluded, 1);
  });
});
