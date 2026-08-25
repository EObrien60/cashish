/**
 * Excluding transactions.
 *
 * The promise is "counted nowhere". That is only true if every number in the app agrees,
 * so this checks the actual reports rather than just the list.
 */
import assert from "node:assert/strict";
import test from "node:test";

const url = process.env.DATABASE_URL ?? "";
if (!/scratch|test/i.test(url)) {
  throw new Error(`refusing to run against ${url || "the default database"} — use npm test`);
}

/* eslint-disable @typescript-eslint/no-require-imports */
const { db, schema } = require("../src/db/client") as typeof import("../src/db/client");
const { boot } = require("../src/lib/boot") as typeof import("../src/lib/boot");
const {
  listTransactions,
  setExcluded,
  transactionCounts,
} = require("../src/lib/transactions") as typeof import("../src/lib/transactions");
const { profitAndLoss } = require("../src/lib/reports") as typeof import("../src/lib/reports");
const { computeVatReturn } = require("../src/lib/vat") as typeof import("../src/lib/vat");
const { reconcileReport } = require("../src/lib/reconcile") as typeof import("../src/lib/reconcile");
const { buildIntegrationSummary } = require("../src/lib/integration") as typeof import("../src/lib/integration");
const { uid } = require("../src/lib/id") as typeof import("../src/lib/id");

boot();

const addTx = (description: string, amount: number, categoryId: string | null = null) => {
  const id = uid();
  db.insert(schema.transactions)
    .values({ id, bookedDate: "2026-07-15", amount, description, categoryId, importBatch: uid() })
    .run();
  return id;
};

test("an excluded transaction is counted nowhere", () => {
  db.delete(schema.transactions).run();

  const kept = addTx("REAL CLIENT PAYMENT", 1000, "cat-sales");
  const potTransfer = addTx("To VAT", -500, "cat-tax");

  const before = await profitAndLoss("2026-07-01", "2026-07-31");
  assert.equal(before.totalIncome, 1000);
  assert.equal(before.totalExpense, 500, "the transfer is counted as an expense to begin with");

  await setExcluded([potTransfer], true, "internal pot transfer, not an expense");

  const after = await profitAndLoss("2026-07-01", "2026-07-31");
  assert.equal(after.totalIncome, 1000, "income is untouched");
  assert.equal(after.totalExpense, 0, "the excluded transfer is out of the P&L");
  assert.equal(after.net, 1000);

  // Out of the list by default, and its own tab shows it.
  assert.deepEqual(await listTransactions().map((t) => t.id), [kept]);
  assert.deepEqual(await listTransactions({ excluded: "only" }).map((t) => t.id), [potTransfer]);
  assert.equal(await listTransactions({ excluded: "all" }).length, 2, "reconciling a statement needs every line");

  const counts = await transactionCounts();
  assert.deepEqual(counts, { included: 1, excluded: 1, uncategorised: 0 });

  // And excluding cleared the category, because it is out of the books entirely.
  const row = await listTransactions({ excluded: "only" })[0];
  assert.equal(row?.categoryId, null);
  assert.equal(row?.excludedReason, "internal pot transfer, not an expense");
});

test("an excluded inflow is not money waiting to be invoiced", () => {
  db.delete(schema.transactions).run();
  const own = addTx("From VAT", 700);

  assert.equal(await reconcileReport().unmatchedInflows, 1, "it looks like unexplained money at first");
  assert.equal(await buildIntegrationSummary("2026-08-24").bank.unmatchedInflowCount, 1);

  await setExcluded([own], true, "money coming back from our own VAT pot");

  assert.equal(await reconcileReport().unmatchedInflows, 0, "not an inflow needing an invoice");
  const summary = await buildIntegrationSummary("2026-08-24");
  assert.equal(summary.bank.unmatchedInflowCount, 0, "and Lunar is not told about it either");
  assert.equal(summary.bank.unmatchedInflowTotal, 0);
});

test("excluding is reversible and leaves the row in place", () => {
  db.delete(schema.transactions).run();
  const id = addTx("MAYBE A MISTAKE", -42);

  await setExcluded([id], true, "wrong card");
  assert.equal(await transactionCounts().excluded, 1);

  await setExcluded([id], false);
  const counts = await transactionCounts();
  assert.equal(counts.excluded, 0);
  assert.equal(counts.included, 1, "the row was never deleted");
  assert.equal(await listTransactions()[0]?.excludedReason, "", "the stale reason is cleared with the flag");
});

test("VAT ignores excluded transactions", () => {
  db.delete(schema.transactions).run();
  const purchase = addTx("SOME SUPPLIER", -1230, "cat-software");
  db.update(schema.transactions).set({ vatRateId: "vat-standard" }).run();

  const before = await computeVatReturn("2026-07-01", "2026-09-30");
  await setExcluded([purchase], true, "personal");
  const after = await computeVatReturn("2026-07-01", "2026-09-30");

  assert.notEqual(before.t2_purchasesVat, 0, "it was reclaimable to begin with");
  assert.equal(after.t2_purchasesVat, 0, "and now it is not");
  assert.equal(after.netPurchases, 0);
});
