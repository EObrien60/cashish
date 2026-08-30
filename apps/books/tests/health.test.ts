/**
 * Financial health.
 *
 * The figures here are the ones an owner acts on, so the edges matter more than the
 * happy path: a business that is not burning has no runway rather than an infinite
 * one, aging buckets must not lose a day at their boundaries, and days-sales-
 * outstanding has to be weighted or one tiny late invoice defines the business.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import { asTenant, makeTenant, closePool } from "./harness";
import { db, schema } from "@cashish/core/db";
import { createCustomer } from "../src/lib/customers";
import { createInvoice, recordPayment } from "../src/lib/invoices";
import { uid } from "../src/lib/id";
import {
  businessHealth,
  concentration,
  currentVatPeriod,
  direction,
  receivables,
  runway,
  RUNWAY_CAP_MONTHS,
} from "../src/lib/health";

let tenant: string;
const ASOF = "2026-08-31";

before(async () => {
  tenant = (await makeTenant("health")).id;
});
after(closePool);

const reset = () =>
  asTenant(tenant, async () => {
    await db.delete(schema.payments).where(eq(schema.payments.tenantId, tenant));
    await db.delete(schema.invoiceLines).where(eq(schema.invoiceLines.tenantId, tenant));
    await db.delete(schema.invoices).where(eq(schema.invoices.tenantId, tenant));
    await db.delete(schema.transactions).where(eq(schema.transactions.tenantId, tenant));
  });

const tx = (
  bookedDate: string,
  amount: number,
  extra: Partial<typeof schema.transactions.$inferInsert> = {},
) =>
  asTenant(tenant, async () => {
    const id = uid();
    await db.insert(schema.transactions).values({
      id,
      tenantId: tenant,
      bookedDate,
      amount,
      description: amount >= 0 ? "Money in" : "Money out",
      importBatch: "test",
      ...extra,
    });
    return id;
  });

test("a burning business gets a runway; a profitable one does not", async () => {
  await reset();
  await asTenant(tenant, async () => {
    // Three months out at 1,000/month, and 3,000 left in the bank.
    await tx("2026-06-15", -1000);
    await tx("2026-07-15", -1000);
    await tx("2026-08-15", -1000, { balance: 3000 });

    const burning = await runway(ASOF);
    assert.equal(burning.burning, true);
    assert.equal(burning.cash, 3000);
    assert.ok(
      Math.abs(burning.monthlyNet + 1000) < 60,
      `expected about -1000 a month, got ${burning.monthlyNet}`,
    );
    assert.ok(burning.months !== null && burning.months > 2.5 && burning.months < 3.5, `got ${burning.months} months`);
  });

  await reset();
  await asTenant(tenant, async () => {
    await tx("2026-07-15", 5000);
    await tx("2026-08-15", 5000, { balance: 10000 });
    const healthy = await runway(ASOF);
    assert.equal(healthy.burning, false);
    assert.equal(healthy.months, null, "not burning means there is no runway, not an infinite one");
  });
});

test("runway longer than we count is reported as comfortable, not a silly number", async () => {
  await reset();
  await asTenant(tenant, async () => {
    await tx("2026-08-15", -10, { balance: 500_000 });
    const r = await runway(ASOF);
    assert.equal(r.burning, true);
    assert.equal(r.comfortable, true);
    assert.equal(r.months, RUNWAY_CAP_MONTHS, "capped rather than claiming thousands of months");
  });
});

test("an empty book does not invent a runway", async () => {
  await reset();
  await asTenant(tenant, async () => {
    const r = await runway(ASOF);
    assert.equal(r.cash, null, "no statement means no balance, not zero");
    assert.equal(r.months, null);
    assert.equal(r.monthlyNet, 0);
  });
});

test("aging buckets keep every euro and hold at their boundaries", async () => {
  await reset();
  await asTenant(tenant, async () => {
    const { customer } = await createCustomer({ name: "Aging Client" });
    // Due dates chosen so each lands exactly on a boundary relative to 2026-08-31.
    const dues: [string, string, number][] = [
      ["9001", "2026-09-30", 100], // not yet due
      ["9002", "2026-08-31", 200], // due today, so not overdue
      ["9003", "2026-08-01", 400], // 30 days late
      ["9004", "2026-07-31", 800], // 31 days late
      ["9005", "2026-07-02", 1600], // 60 days late
      ["9006", "2026-07-01", 3200], // 61 days late
    ];
    for (const [number, dueDate, total] of dues) {
      await createInvoice({
        customerId: customer.id,
        number,
        status: "sent",
        issueDate: "2026-06-01",
        dueDate,
        lines: [{ description: "Work", quantity: 1, unitPrice: total, vatRateId: null, productId: null }],
      });
    }

    const ar = await receivables(ASOF);
    assert.equal(ar.total, 6300, "every open invoice counted once");
    assert.equal(ar.count, 6);
    assert.deepEqual(
      ar.buckets.map((b) => [b.label, b.amount]),
      [
        ["Not yet due", 300], // 9001 and 9002
        ["1–30 days", 400],
        ["31–60 days", 2400], // 9004 and 9005
        ["60+ days", 3200],
      ],
    );
    assert.equal(
      ar.buckets.reduce((s, b) => s + b.amount, 0),
      ar.total,
      "the buckets must add back to the total",
    );
    assert.equal(ar.overdue, 6000, "due today is not overdue");
    assert.equal(ar.worst[0]?.number, "9006", "the latest invoice leads the chase list");
  });
});

test("a draft invoice is not a receivable", async () => {
  await reset();
  await asTenant(tenant, async () => {
    const { customer } = await createCustomer({ name: "Draft Client" });
    await createInvoice({
      customerId: customer.id,
      number: "9100",
      status: "draft",
      issueDate: "2026-06-01",
      dueDate: "2026-07-01",
      lines: [{ description: "Work", quantity: 1, unitPrice: 5000, vatRateId: null, productId: null }],
    });
    const ar = await receivables(ASOF);
    assert.equal(ar.total, 0, "nothing was sent, so nobody owes it");
    assert.equal(ar.count, 0);

    const health = await businessHealth(ASOF);
    const draft = health.actions.find((a) => a.label === "Send draft invoices");
    assert.ok(draft, "it belongs in the action list instead");
    assert.equal(draft.count, 1);
  });
});

test("days sales outstanding is weighted by value and ignores unpaid invoices", async () => {
  await reset();
  await asTenant(tenant, async () => {
    const { customer } = await createCustomer({ name: "Payer" });
    // A large invoice paid quickly and a tiny one paid very late. Unweighted this
    // would average to 50 days and misdescribe the business entirely.
    const big = await createInvoice({
      customerId: customer.id,
      number: "9201",
      status: "sent",
      issueDate: "2026-06-01",
      lines: [{ description: "Work", quantity: 1, unitPrice: 9900, vatRateId: null, productId: null }],
    });
    const small = await createInvoice({
      customerId: customer.id,
      number: "9202",
      status: "sent",
      issueDate: "2026-06-01",
      lines: [{ description: "Work", quantity: 1, unitPrice: 100, vatRateId: null, productId: null }],
    });
    // Never paid, and far later — must not count at all.
    await createInvoice({
      customerId: customer.id,
      number: "9203",
      status: "sent",
      issueDate: "2026-01-01",
      lines: [{ description: "Work", quantity: 1, unitPrice: 5000, vatRateId: null, productId: null }],
    });
    await recordPayment(big!.id, { date: "2026-06-11", amount: 9900 });
    await recordPayment(small!.id, { date: "2026-09-09", amount: 100 });

    const ar = await receivables(ASOF);
    // (10 days x 9900 + 100 days x 100) / 10000 = 10.9 -> 11
    assert.equal(ar.dso, 11, "the big fast invoice dominates, as it should");
  });
});

test("concentration says how exposed the business is, and admits when it cannot tell", async () => {
  await reset();
  await asTenant(tenant, async () => {
    const a = await createCustomer({ name: "Whale" });
    const b = await createCustomer({ name: "Minnow" });
    await tx("2026-08-01", 7500, { customerId: a.customer.id });
    await tx("2026-08-02", 2500, { customerId: b.customer.id });
    // Money in with no customer must not dilute the shares.
    await tx("2026-08-03", 1000);

    const c = await concentration(ASOF);
    assert.equal(c.total, 10000, "only attributed money counts");
    assert.equal(c.topShare, 75);
    assert.equal(c.lines[0]?.name, "Whale");
    assert.equal(c.thin, false);

    await reset();
    const single = await createCustomer({ name: "Only One" });
    await tx("2026-08-01", 100, { customerId: single.customer.id });
    const thin = await concentration(ASOF);
    assert.equal(thin.topShare, 100);
    assert.equal(thin.thin, true, "one customer is not a concentration finding, it is no data");
  });
});

test("direction covers twelve months and compares like with like", async () => {
  await reset();
  await asTenant(tenant, async () => {
    await tx("2026-08-10", 1000);
    await tx("2026-07-10", 1000);
    await tx("2026-06-10", 1000);
    await tx("2026-05-10", 500);
    await tx("2026-04-10", 500);
    await tx("2026-03-10", 500);
    // Older than the window; must be ignored entirely.
    await tx("2024-01-10", 999_999);

    const d = await direction(ASOF);
    assert.equal(d.months.length, 12, "always twelve slots, even the empty ones");
    assert.equal(d.months[11]?.month, "2026-08");
    assert.equal(d.months[0]?.month, "2025-09");
    assert.equal(d.revenue.now, 3000, "the trailing three months");
    assert.equal(d.revenue.prior, 1500, "and the three before them");
    assert.equal(d.revenue.change, 100, "doubling reads as +100%");
    assert.ok(!d.months.some((m) => m.income > 900_000), "the out-of-window row stayed out");
  });
});

test("a change from nothing is not a percentage", async () => {
  await reset();
  await asTenant(tenant, async () => {
    await tx("2026-08-10", 1000);
    const d = await direction(ASOF);
    assert.equal(d.revenue.prior, 0);
    assert.equal(d.revenue.change, null, "growth from zero is undefined, not infinite");
  });
});

test("the VAT period is the bi-monthly one containing the date", async () => {
  assert.equal(currentVatPeriod("2026-08-31").label, "Jul–Aug 2026");
  assert.equal(currentVatPeriod("2026-01-01").label, "Jan–Feb 2026");
  assert.equal(currentVatPeriod("2026-12-31").label, "Nov–Dec 2026");
});

test("free cash subtracts what is already spoken for", async () => {
  await reset();
  await asTenant(tenant, async () => {
    // Wages every month for three months, and a balance that looks healthy.
    const emp = uid();
    await db.insert(schema.employees).values({
      id: emp,
      tenantId: tenant,
      firstName: "Some",
      familyName: "One",
    });
    await tx("2026-06-25", -2000, { employeeId: emp });
    await tx("2026-07-25", -2000, { employeeId: emp });
    await tx("2026-08-25", -2000, { employeeId: emp, balance: 5000 });

    const health = await businessHealth(ASOF);
    const payroll = health.committed.items.find((i) => i.kind === "payroll");
    assert.ok(payroll, "recurring wages are a commitment even with no pay run entered");
    assert.ok(Math.abs(payroll.amount - 2000) < 120, `expected about 2000, got ${payroll.amount}`);
    assert.ok(
      health.committed.free !== null && health.committed.free < 5000,
      "free cash is less than the balance",
    );
  });
});
