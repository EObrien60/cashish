/**
 * Vendors and bills.
 *
 * The parts worth pinning down are the ones that decide whether a figure is
 * true: that a bill's total cannot disagree with its net and VAT, that status
 * follows the money rather than being set by hand, that a payment cannot be
 * posted to two bills or predate the bill it supposedly paid, and that lifetime
 * spend comes from the bank rather than from what you were billed.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import { asTenant, makeTenant, seeded, closePool } from "./harness";
import { db, schema } from "../src/db/client";
import { uid } from "../src/lib/id";
import {
  createVendor,
  getVendorDetail,
  listVendors,
  setTransactionVendor,
  vendorTotals,
} from "../src/lib/vendors";
import {
  createBill,
  getBill,
  postBillToTransaction,
  recordBillPayment,
  setBillStatus,
  listPayables,
  candidateTransactionsFor,
  deleteBill,
} from "../src/lib/bills";
import { setExcluded } from "../src/lib/transactions";

let a: string;
let b: string;
const cat = (t: string, base: string) => seeded(t, base);

before(async () => {
  a = (await makeTenant("vend-a")).id;
  b = (await makeTenant("vend-b")).id;
});
after(closePool);

const pay = (tenant: string, description: string, amount: number, date: string) =>
  asTenant(tenant, async () => {
    const id = uid();
    await db.insert(schema.transactions).values({
      id,
      tenantId: tenant,
      bookedDate: date,
      amount: -Math.abs(amount),
      description,
      importBatch: uid(),
    });
    return id;
  });

test("a bill's total is derived, so it cannot disagree with net and VAT", async () => {
  await asTenant(a, async () => {
    const { vendor } = await createVendor({ name: "TD Synnex Ireland" });
    const bill = await createBill({
      vendorId: vendor.id,
      number: "INV-1",
      issueDate: "2026-05-01",
      net: 1000,
      vatTotal: 230,
    });
    assert.equal(bill?.total, 1230);
    assert.equal(bill?.status, "awaiting", "unpaid on arrival");
    assert.equal(bill?.outstanding, 1230);
  });
});

test("posting a bill against a payment takes the amount from the bank", async () => {
  const tx = await pay(a, "TD SYNNEX IRELAND LIMITED", 1230, "2026-05-10");
  await asTenant(a, async () => {
    const vendor = (await listVendors()).find((v) => v.name.startsWith("TD Synnex"))!;
    const bill = await createBill({
      vendorId: vendor.id,
      number: "INV-2",
      issueDate: "2026-05-02",
      net: 1000,
      vatTotal: 230,
    });
    const posted = await postBillToTransaction(bill!.id, tx);
    assert.equal(posted?.status, "paid");
    assert.equal(posted?.amountPaid, 1230);
    assert.equal(posted?.outstanding, 0);
    assert.equal(posted?.payments[0].transactionId, tx, "linked to the bank line");

    // Posting also attributes the bank line to the vendor, so spend follows.
    const detail = await getVendorDetail(vendor.id);
    assert.ok(
      detail!.transactions.some((t) => t.id === tx),
      "the payment now belongs to the vendor",
    );
  });
});

test("a bank line cannot pay two bills", async () => {
  const tx = await pay(a, "DOUBLE POST", 500, "2026-06-10");
  await asTenant(a, async () => {
    const { vendor } = await createVendor({ name: "Double Post Ltd" });
    const one = await createBill({ vendorId: vendor.id, issueDate: "2026-06-01", net: 500, vatTotal: 0 });
    const two = await createBill({ vendorId: vendor.id, issueDate: "2026-06-01", net: 500, vatTotal: 0 });
    await postBillToTransaction(one!.id, tx);
    await assert.rejects(
      () => postBillToTransaction(two!.id, tx),
      /already posted/,
      "the same money cannot settle two different bills",
    );
  });
});

test("a payment that predates the bill cannot be what paid it", async () => {
  const early = await pay(a, "TOO EARLY", 300, "2026-01-05");
  await asTenant(a, async () => {
    const { vendor } = await createVendor({ name: "Chronology Ltd" });
    const bill = await createBill({ vendorId: vendor.id, issueDate: "2026-03-01", net: 300, vatTotal: 0 });
    await assert.rejects(() => postBillToTransaction(bill!.id, early), /before the bill was issued/);
  });
});

test("money in cannot pay a bill", async () => {
  const inflow = await asTenant(a, async () => {
    const id = uid();
    await db.insert(schema.transactions).values({
      id,
      tenantId: a,
      bookedDate: "2026-06-20",
      amount: 400,
      description: "A REFUND",
      importBatch: uid(),
    });
    return id;
  });
  await asTenant(a, async () => {
    const { vendor } = await createVendor({ name: "Refund Ltd" });
    const bill = await createBill({ vendorId: vendor.id, issueDate: "2026-06-01", net: 400, vatTotal: 0 });
    await assert.rejects(() => postBillToTransaction(bill!.id, inflow), /money in/);
  });
});

test("a part payment leaves the bill partial, and finishing it marks it paid", async () => {
  await asTenant(a, async () => {
    const { vendor } = await createVendor({ name: "Instalments Ltd" });
    const bill = await createBill({ vendorId: vendor.id, issueDate: "2026-04-01", net: 900, vatTotal: 0 });
    await recordBillPayment(bill!.id, { date: "2026-04-10", amount: 400 });
    let now = await getBill(bill!.id);
    assert.equal(now?.status, "partial");
    assert.equal(now?.outstanding, 500);

    await recordBillPayment(bill!.id, { date: "2026-04-20", amount: 500 });
    now = await getBill(bill!.id);
    assert.equal(now?.status, "paid");
    assert.equal(now?.outstanding, 0);
  });
});

test("voiding takes a bill out of what is owed", async () => {
  await asTenant(a, async () => {
    const { vendor } = await createVendor({ name: "Void Ltd" });
    const bill = await createBill({ vendorId: vendor.id, issueDate: "2026-07-01", net: 111, vatTotal: 0 });
    assert.ok((await listPayables()).some((p) => p.id === bill!.id));
    await setBillStatus(bill!.id, "void");
    assert.ok(!(await listPayables()).some((p) => p.id === bill!.id), "a void bill is not owed");
  });
});

test("candidate payments are money out, unposted, and closest amount first", async () => {
  const far = await pay(a, "NEARLY RIGHT", 812.5, "2026-08-02");
  const exact = await pay(a, "SPOT ON", 750, "2026-08-03");
  await asTenant(a, async () => {
    const { vendor } = await createVendor({ name: "Candidates Ltd" });
    const bill = await createBill({ vendorId: vendor.id, issueDate: "2026-08-01", net: 750, vatTotal: 0 });
    const candidates = await candidateTransactionsFor(bill!.id);
    assert.equal(candidates[0].id, exact, "the exact amount leads");
    assert.equal(candidates[0].exact, true);
    assert.ok(candidates.some((c) => c.id === far));
    // Once posted, that payment is no longer offered for anything else.
    await postBillToTransaction(bill!.id, exact);
    const second = await createBill({ vendorId: vendor.id, issueDate: "2026-08-01", net: 750, vatTotal: 0 });
    const again = await candidateTransactionsFor(second!.id);
    assert.ok(!again.some((c) => c.id === exact), "a posted payment is spent");
  });
});

test("lifetime spend comes from the bank, not from what you were billed", async () => {
  const t1 = await pay(a, "SPEND ONE", 200, "2026-02-01");
  const t2 = await pay(a, "SPEND TWO", 300, "2026-02-02");
  await asTenant(a, async () => {
    const { vendor } = await createVendor({ name: "Spend Ltd" });
    // Billed 5,000 but only 500 has actually left the account.
    await createBill({ vendorId: vendor.id, issueDate: "2026-02-01", net: 5000, vatTotal: 0 });
    await setTransactionVendor([t1, t2], vendor.id);

    const detail = await getVendorDetail(vendor.id);
    assert.equal(detail?.totals.lifetimeSpend, 500, "the bank is the fact");
    assert.equal(detail?.totals.txCount, 2);
    assert.equal(detail?.totals.billed, 5000, "and billed is reported beside it");
    assert.equal(detail?.totals.billsOutstanding, 5000);

    // Excluding a payment removes it from spend, as everywhere else.
    await setExcluded([t1], true, "personal");
    assert.equal((await getVendorDetail(vendor.id))?.totals.lifetimeSpend, 300);
    const totals = await vendorTotals();
    assert.equal(totals.get(vendor.id)?.spend, 300);
  });
});

test("a vendor from another business cannot be attached or reached", async () => {
  const mine = await pay(a, "LOCAL SPEND", 50, "2026-09-01");
  const theirs = await asTenant(b, async () => (await createVendor({ name: "Their Vendor" })).vendor.id);
  await asTenant(a, async () => {
    await assert.rejects(
      () => setTransactionVendor([mine], theirs),
      /does not belong to this business/,
    );
    assert.ok(!(await listVendors({ includeArchived: true })).some((v) => v.name === "Their Vendor"));
    assert.equal(await getVendorDetail(theirs), null);
  });
});

test("deleting an unpaid bill removes it; its vendor survives", async () => {
  await asTenant(a, async () => {
    const { vendor } = await createVendor({ name: "Deletable Ltd" });
    const bill = await createBill({ vendorId: vendor.id, issueDate: "2026-10-01", net: 75, vatTotal: 0 });
    await deleteBill(bill!.id);
    assert.equal(await getBill(bill!.id), null);
    const detail = await getVendorDetail(vendor.id);
    assert.equal(detail?.bills.length, 0);
    assert.ok(detail?.vendor, "the vendor is not collateral damage");
  });
});
