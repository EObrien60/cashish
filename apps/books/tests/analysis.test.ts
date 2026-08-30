/**
 * Management reporting.
 *
 * These are the numbers someone makes a decision on, so the arithmetic is
 * pinned down rather than eyeballed: what counts as cost of sales, what a
 * margin does when revenue is zero, and that a margin change is reported in
 * percentage POINTS rather than as a percentage of a percentage.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { and, eq } from "drizzle-orm";
import { asTenant, makeTenant, seeded, closePool } from "./harness";
import { db, schema } from "@cashish/core/db";
import { uid } from "../src/lib/id";
import {
  marginReport,
  spendReport,
  revenueReport,
  trendReport,
  priorWindow,
} from "../src/lib/analysis";
import { createCustomer } from "../src/lib/customers";
import { createInvoice } from "../src/lib/invoices";

let t: string;
const cat = (base: string) => seeded(t, base);

before(async () => {
  t = (await makeTenant("analysis")).id;
});
after(closePool);

const tx = (
  amount: number,
  categoryId: string | null,
  date: string,
  description = "line",
) =>
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

const clear = () =>
  asTenant(t, () => db.delete(schema.transactions).where(eq(schema.transactions.tenantId, t)));

test("the comparison period follows the calendar, not just day arithmetic", () => {
  // A whole month compares with the previous whole month, whatever their lengths.
  // Equal-length arithmetic would answer 31 May – 30 June for July, which is not
  // what anyone means by "last month".
  assert.deepEqual(priorWindow("2026-07-01", "2026-07-31"), {
    from: "2026-06-01",
    to: "2026-06-30",
  });
  assert.deepEqual(
    priorWindow("2026-03-01", "2026-03-31"),
    { from: "2026-02-01", to: "2026-02-28" },
    "March compares with a 28-day February",
  );

  assert.deepEqual(priorWindow("2026-01-01", "2026-12-31"), {
    from: "2025-01-01",
    to: "2025-12-31",
  });
  assert.deepEqual(
    priorWindow("2026-07-01", "2026-09-30"),
    { from: "2026-04-01", to: "2026-06-30" },
    "a whole quarter compares with the previous quarter",
  );

  // Year to date compares with the same span last year, which is the only
  // comparison that survives a seasonal business.
  assert.deepEqual(priorWindow("2026-01-01", "2026-08-26"), {
    from: "2025-01-01",
    to: "2025-08-26",
  });
  // Month to date likewise.
  assert.deepEqual(priorWindow("2026-08-01", "2026-08-26"), {
    from: "2026-07-01",
    to: "2026-07-26",
  });

  // Anything arbitrary falls back to the same number of days immediately before.
  assert.deepEqual(priorWindow("2026-05-15", "2026-06-14"), {
    from: "2026-04-14",
    to: "2026-05-14",
  });
  assert.deepEqual(
    priorWindow("2026-03-10", "2026-03-10"),
    { from: "2026-03-09", to: "2026-03-09" },
    "a single day compares with the day before",
  );
});

test("gross margin uses the cost-of-sales flag, not the category name", async () => {
  await clear();
  await tx(10000, cat("cat-sales"), "2026-07-05");
  await tx(-6000, cat("cat-cogs"), "2026-07-06"); // flagged cost of sales
  await tx(-1000, cat("cat-software"), "2026-07-07"); // an overhead
  await tx(-500, cat("cat-rent"), "2026-07-08"); // an overhead

  await asTenant(t, async () => {
    const r = await marginReport("2026-07-01", "2026-07-31");
    assert.equal(r.now.revenue, 10000);
    assert.equal(r.now.costOfSales, 6000);
    assert.equal(r.now.grossProfit, 4000);
    assert.equal(r.now.grossMarginPct, 40);
    assert.equal(r.now.overheads, 1500);
    assert.equal(r.now.operatingProfit, 2500);
    assert.equal(r.now.netMarginPct, 25);
  });
});

test("clearing the flag moves spend out of cost of sales", async () => {
  await asTenant(t, async () => {
    // Same data as above; only the flag changes.
    await db
      .update(schema.categories)
      .set({ costOfSales: false })
      .where(and(eq(schema.categories.tenantId, t), eq(schema.categories.id, cat("cat-cogs"))));

    const r = await marginReport("2026-07-01", "2026-07-31");
    assert.equal(r.now.costOfSales, 0);
    assert.equal(r.now.grossProfit, 10000, "with nothing direct, gross profit is revenue");
    assert.equal(r.now.grossMarginPct, 100);
    assert.equal(r.now.overheads, 7500);
    assert.equal(r.now.operatingProfit, 2500, "operating profit is unchanged either way");

    // Put it back for the remaining tests.
    await db
      .update(schema.categories)
      .set({ costOfSales: true })
      .where(and(eq(schema.categories.tenantId, t), eq(schema.categories.id, cat("cat-cogs"))));
  });
});

test("a margin change is reported in points, and zero revenue is not a division", async () => {
  await clear();
  // Prior month: 50% gross margin. This month: 60%.
  await tx(1000, cat("cat-sales"), "2026-06-10");
  await tx(-500, cat("cat-cogs"), "2026-06-11");
  await tx(2000, cat("cat-sales"), "2026-07-10");
  await tx(-800, cat("cat-cogs"), "2026-07-11");

  await asTenant(t, async () => {
    const r = await marginReport("2026-07-01", "2026-07-31");
    assert.equal(r.before.grossMarginPct, 50);
    assert.equal(r.now.grossMarginPct, 60);
    assert.equal(r.change.grossMarginPts, 10, "ten POINTS, not twenty percent");
    assert.equal(r.change.revenue, 100, "revenue doubled");
  });

  await clear();
  await asTenant(t, async () => {
    const r = await marginReport("2026-07-01", "2026-07-31");
    assert.equal(r.now.revenue, 0);
    assert.equal(r.now.grossMarginPct, 0, "no revenue means no margin, not NaN or Infinity");
    assert.equal(r.change.revenue, null, "and no percentage change from nothing");
  });
});

test("uncategorised money still reaches the totals, and is flagged", async () => {
  await clear();
  await tx(1000, cat("cat-sales"), "2026-07-05");
  await tx(500, null, "2026-07-06", "MYSTERY INFLOW");
  await tx(-200, null, "2026-07-07", "MYSTERY OUTFLOW");

  await asTenant(t, async () => {
    const r = await marginReport("2026-07-01", "2026-07-31");
    assert.equal(r.now.revenue, 1500, "unattributed money in still counts as revenue");
    assert.equal(r.now.overheads, 200);
    assert.equal(r.now.uncategorised.count, 2);
    assert.equal(r.now.uncategorised.income, 500);
    assert.equal(r.now.uncategorised.expense, 200);
  });
});

test("spend is grouped by category and by who was paid", async () => {
  await clear();
  await tx(-3000, cat("cat-cogs"), "2026-07-02", "TD SYNNEX IRELAND");
  await tx(-1000, cat("cat-cogs"), "2026-07-09", "TD SYNNEX IRELAND");
  await tx(-500, cat("cat-software"), "2026-07-11", "GITHUB, INC.");
  // An inflow into an income category is not spend.
  await tx(9000, cat("cat-sales"), "2026-07-12", "CLIENT PAYMENT");

  await asTenant(t, async () => {
    const r = await spendReport("2026-07-01", "2026-07-31");
    assert.equal(r.total, 4500, "income is excluded from spend");
    const cogs = r.lines.find((l) => l.costOfSales)!;
    assert.equal(cogs.amount, 4000);
    assert.equal(cogs.count, 2);
    assert.equal(cogs.sharePct, 88.89);
    assert.equal(r.lines[0].amount, 4000, "biggest first");

    const synnex = r.counterparties.find((c) => c.name.includes("SYNNEX"))!;
    assert.equal(synnex.amount, 4000, "two payments to the same name are one row");
    assert.equal(synnex.count, 2);
    assert.ok(
      !r.counterparties.some((c) => c.name.includes("CLIENT PAYMENT")),
      "money in is not someone you paid",
    );
  });
});

test("revenue concentration is measured on invoiced, not on cash", async () => {
  await asTenant(t, async () => {
    const big = (await createCustomer({ name: "Dominant Client" })).customer;
    const small = (await createCustomer({ name: "Small Client" })).customer;
    const line = (unitPrice: number) => [
      { description: "Work", quantity: 1, unitPrice, vatRateId: null, productId: null },
    ];
    await createInvoice({ customerId: big.id, number: "A1", status: "sent", issueDate: "2026-07-03", lines: line(8000) });
    await createInvoice({ customerId: small.id, number: "A2", status: "sent", issueDate: "2026-07-04", lines: line(1500) });
    await createInvoice({ customerId: small.id, number: "A3", status: "sent", issueDate: "2026-07-05", lines: line(500) });

    const r = await revenueReport("2026-07-01", "2026-07-31");
    assert.equal(r.invoicedTotal, 10000);
    assert.equal(r.customers[0].name, "Dominant Client");
    assert.equal(r.customers[0].sharePct, 80);
    assert.equal(r.customers[0].invoiceCount, 1);
    assert.equal(r.topShare, 80);
    assert.equal(r.customersToHalf, 1, "one customer is more than half the revenue");

    // A voided invoice is not revenue.
    await createInvoice({ customerId: small.id, number: "A4", status: "void", issueDate: "2026-07-06", lines: line(50000) });
    assert.equal((await revenueReport("2026-07-01", "2026-07-31")).invoicedTotal, 10000);
  });
});

test("the monthly trend splits each month on its own", async () => {
  await clear();
  await tx(1000, cat("cat-sales"), "2026-05-10");
  await tx(-400, cat("cat-cogs"), "2026-05-11");
  await tx(-100, cat("cat-software"), "2026-05-12");
  await tx(3000, cat("cat-sales"), "2026-06-10");
  await tx(-1500, cat("cat-cogs"), "2026-06-11");

  await asTenant(t, async () => {
    const r = await trendReport("2026-05-01", "2026-06-30");
    assert.equal(r.length, 2);
    assert.deepEqual(
      r.map((m) => m.month),
      ["2026-05", "2026-06"],
      "oldest first",
    );
    assert.equal(r[0].grossProfit, 600);
    assert.equal(r[0].grossMarginPct, 60);
    assert.equal(r[0].net, 500);
    assert.equal(r[1].grossMarginPct, 50);
    assert.equal(r[1].net, 1500, "no overheads that month");
  });
});
