/**
 * The cash flow forecast.
 *
 * The cases that matter are the ones where a forecast quietly lies: a one-off
 * payment carried forward as if it were a subscription, an annual premium
 * inflating every month's median, and a closing balance that does not actually
 * chain into the next month's opening. Each is asserted here.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import { asTenant, makeTenant, closePool, seeded } from "./harness";
import { db, schema } from "@cashish/core/db";
import { createCustomer } from "../src/lib/customers";
import { createInvoice } from "../src/lib/invoices";
import { buildCashflowForecast, monthsBetween, defaultWindow } from "../src/lib/cashflow";
import { cashflowWorkbook } from "../src/lib/cashflow-xlsx";
import { uid } from "../src/lib/id";

let tenant: string;

before(async () => {
  tenant = (await makeTenant("cashflow")).id;
});
after(closePool);

const reset = () =>
  asTenant(tenant, async () => {
    await db.delete(schema.payments).where(eq(schema.payments.tenantId, tenant));
    await db.delete(schema.invoiceLines).where(eq(schema.invoiceLines.tenantId, tenant));
    await db.delete(schema.invoices).where(eq(schema.invoices.tenantId, tenant));
    await db.delete(schema.transactions).where(eq(schema.transactions.tenantId, tenant));
  });

/** A bank line. `balance` is the running account balance the statement carried. */
const tx = (
  description: string,
  amount: number,
  bookedDate: string,
  balance?: number,
) =>
  asTenant(tenant, async () => {
    const id = uid();
    await db.insert(schema.transactions).values({
      id,
      tenantId: tenant,
      bookedDate,
      amount,
      description,
      importBatch: uid(),
      ...(balance === undefined ? {} : { balance }),
    });
    return id;
  });

// A fixed window so the assertions do not drift with the calendar.
const WINDOW = { from: "2026-07-01", to: "2026-09-30" };

test("months are the columns, and a window inside one year keeps bare month names", () => {
  const months = monthsBetween("2026-07-01", "2026-09-30");
  assert.deepEqual(
    months.map((m) => m.label),
    ["July", "August", "September"],
  );
  assert.equal(months[0].from, "2026-07-01");
  assert.equal(months[1].to, "2026-08-31");
});

test("a window that crosses a year qualifies the month names", () => {
  const months = monthsBetween("2026-11-01", "2027-02-28");
  assert.deepEqual(
    months.map((m) => m.label),
    ["Nov 2026", "Dec 2026", "Jan 2027", "Feb 2027"],
  );
});

test("the default window is this month plus the next nine", () => {
  const w = defaultWindow("2026-09-06");
  assert.equal(w.from, "2026-09-01");
  assert.equal(w.to, "2027-06-30");
  assert.equal(monthsBetween(w.from, w.to).length, 10);
});

test("the opening balance is the bank's own, and each month opens where the last closed", async () => {
  await reset();
  await tx("Opening float", 5000, "2026-06-30", 5000);

  const forecast = await asTenant(tenant, () => buildCashflowForecast(WINDOW));

  assert.equal(forecast.openingBasis, "bank-balance");
  assert.equal(forecast.openingBalance, 5000);
  assert.equal(forecast.balances[0], 5000);
  for (let i = 1; i < forecast.months.length; i++) {
    assert.equal(
      forecast.balances[i],
      forecast.closingBalance[i - 1],
      `month ${i} must open where month ${i - 1} closed`,
    );
  }
});

test("without a statement balance it falls back to the ledger sum, and says so", async () => {
  await reset();
  await tx("Money in", 1200, "2026-05-02");
  await tx("Money out", -200, "2026-05-09");

  const forecast = await asTenant(tenant, () => buildCashflowForecast(WINDOW));
  assert.equal(forecast.openingBasis, "ledger-sum");
  assert.equal(forecast.openingBalance, 1000);
});

test("an outstanding invoice is income in the month it falls due", async () => {
  await reset();
  const { customer } = await asTenant(tenant, () => createCustomer({ name: "Breakthrough Maths" }));
  await asTenant(tenant, () =>
    createInvoice({
      customerId: customer.id,
      issueDate: "2026-07-15",
      dueDate: "2026-08-14",
      status: "sent",
      lines: [{ description: "Stage 5", quantity: 1, unitPrice: 7000, vatRateId: seeded(tenant, "vat-standard") }],
    }),
  );

  const forecast = await asTenant(tenant, () => buildCashflowForecast(WINDOW));
  const row = forecast.income.find((r) => r.label === "Breakthrough Maths");
  assert.ok(row, "the customer should appear as an income line");
  assert.deepEqual(row.amounts, [0, 8610, 0]);
  assert.deepEqual(forecast.totalIncome, [0, 8610, 0]);
});

test("an invoice already overdue lands in the first month rather than falling off the sheet", async () => {
  await reset();
  const { customer } = await asTenant(tenant, () => createCustomer({ name: "Late Payer" }));
  await asTenant(tenant, () =>
    createInvoice({
      customerId: customer.id,
      issueDate: "2026-03-01",
      dueDate: "2026-03-31",
      status: "sent",
      lines: [{ description: "Overdue work", quantity: 1, unitPrice: 1000, vatRateId: null }],
    }),
  );

  const forecast = await asTenant(tenant, () => buildCashflowForecast(WINDOW));
  const row = forecast.income.find((r) => r.label === "Late Payer");
  assert.ok(row);
  assert.deepEqual(row.amounts, [1000, 0, 0]);
});

test("a paid invoice is not forecast income", async () => {
  await reset();
  const { customer } = await asTenant(tenant, () => createCustomer({ name: "Settled Ltd" }));
  await asTenant(tenant, () =>
    createInvoice({
      customerId: customer.id,
      issueDate: "2026-07-01",
      dueDate: "2026-07-31",
      status: "paid",
      lines: [{ description: "Done and paid", quantity: 1, unitPrice: 500, vatRateId: null }],
    }),
  );

  const forecast = await asTenant(tenant, () => buildCashflowForecast(WINDOW));
  assert.equal(forecast.income.length, 0);
});

test("a cost in most months is carried forward; a one-off is not", async () => {
  await reset();
  // Six whole months precede the window: Jan–Jun 2026.
  for (const month of ["01", "02", "03", "04", "05", "06"]) {
    await tx("Vercel Inc", -45, `2026-${month}-04`);
  }
  await tx("Currys electrical", -1200, "2026-04-11"); // bought a laptop once

  const forecast = await asTenant(tenant, () => buildCashflowForecast(WINDOW));

  const recurring = forecast.expenses.find((r) => r.label.includes("Vercel"));
  assert.ok(recurring, "a monthly subscription must be projected");
  assert.deepEqual(recurring.amounts, [-45, -45, -45]);

  const oneOff = forecast.expenses.find((r) => r.label.toLowerCase().includes("currys"));
  assert.equal(oneOff, undefined, "a single purchase must not become a monthly cost");
});

test("a cost that has stopped is not projected forward", async () => {
  await reset();
  // A contractor billed February, March and April, then finished. That clears
  // "half of the last six months" but is over, and carrying it forward would
  // overstate every month on the sheet. The window opens in July, so nothing of
  // theirs falls in either of the two months before it.
  for (const month of ["02", "03", "04"]) {
    await tx("To Katelynn", -1000, `2026-${month}-20`);
  }
  // Someone still on the books, for contrast.
  for (const month of ["03", "04", "05", "06"]) {
    await tx("To Sarah Jane Hughes", -1500, `2026-${month}-20`);
  }

  const forecast = await asTenant(tenant, () => buildCashflowForecast(WINDOW));

  assert.equal(
    forecast.expenses.find((r) => r.label.includes("Katelynn")),
    undefined,
    "a contractor who finished must not be projected",
  );
  const current = forecast.expenses.find((r) => r.label.includes("Sarah Jane"));
  assert.ok(current, "someone still being paid must be projected");
  assert.deepEqual(current.amounts, [-1500, -1500, -1500]);
});

test("the median resists a spike, so one big month does not raise every month", async () => {
  await reset();
  for (const month of ["01", "02", "03", "05", "06"]) {
    await tx("Three Ireland", -32, `2026-${month}-12`);
  }
  await tx("Three Ireland", -900, "2026-04-12"); // a handset, billed once

  const forecast = await asTenant(tenant, () => buildCashflowForecast(WINDOW));
  const row = forecast.expenses.find((r) => r.label.includes("Three"));
  assert.ok(row);
  assert.deepEqual(row.amounts, [-32, -32, -32]);
});

test("excluded transactions do not become forecast expenses", async () => {
  await reset();
  for (const month of ["01", "02", "03", "04", "05", "06"]) {
    const id = await tx("Personal spend", -80, `2026-${month}-08`);
    await asTenant(tenant, async () => {
      await db
        .update(schema.transactions)
        .set({ excluded: true })
        .where(eq(schema.transactions.id, id));
    });
  }

  const forecast = await asTenant(tenant, () => buildCashflowForecast(WINDOW));
  assert.equal(forecast.expenses.length, 0);
});

test("rows with nothing in the window are left off entirely", async () => {
  await reset();
  const { customer } = await asTenant(tenant, () => createCustomer({ name: "Next Year Ltd" }));
  await asTenant(tenant, () =>
    createInvoice({
      customerId: customer.id,
      issueDate: "2027-01-05",
      dueDate: "2027-02-04",
      status: "sent",
      lines: [{ description: "Future work", quantity: 1, unitPrice: 4000, vatRateId: null }],
    }),
  );

  const forecast = await asTenant(tenant, () => buildCashflowForecast(WINDOW));
  assert.equal(
    forecast.income.find((r) => r.label === "Next Year Ltd"),
    undefined,
  );
});

test("net income and the closing balance agree with the lines above them", async () => {
  await reset();
  await tx("Opening float", 10000, "2026-06-30", 10000);
  for (const month of ["01", "02", "03", "04", "05", "06"]) {
    await tx("Sage Ireland", -100, `2026-${month}-15`);
  }
  const { customer } = await asTenant(tenant, () => createCustomer({ name: "Paying Client" }));
  await asTenant(tenant, () =>
    createInvoice({
      customerId: customer.id,
      issueDate: "2026-07-01",
      dueDate: "2026-07-31",
      status: "sent",
      lines: [{ description: "July work", quantity: 1, unitPrice: 2000, vatRateId: null }],
    }),
  );

  const forecast = await asTenant(tenant, () => buildCashflowForecast(WINDOW));

  assert.deepEqual(forecast.totalIncome, [2000, 0, 0]);
  assert.deepEqual(forecast.totalExpenses, [-100, -100, -100]);
  assert.deepEqual(forecast.netIncome, [1900, -100, -100]);
  assert.deepEqual(forecast.closingBalance, [11900, 11800, 11700]);
});

test("the workbook renders, and carries a row per line plus formulas", async () => {
  await reset();
  await tx("Opening float", 2500, "2026-06-30", 2500);
  for (const month of ["01", "02", "03", "04", "05", "06"]) {
    await tx("Hetzner Online GmbH", -10, `2026-${month}-04`);
  }

  const forecast = await asTenant(tenant, () => buildCashflowForecast(WINDOW));
  const buffer = await cashflowWorkbook(forecast, "O'Brien Hughes");

  // A .xlsx is a zip; "PK" is the local file header it must start with.
  assert.equal(buffer.subarray(0, 2).toString(), "PK");
  assert.ok(buffer.length > 4000, "a styled workbook should not be a stub");

  const ExcelJS = (await import("exceljs")).default;
  const read = new ExcelJS.Workbook();
  // ExcelJS declares its own Buffer type, which Node 24's generic one no longer
  // satisfies structurally; the bytes are the same either way.
  type LoadArg = Parameters<typeof read.xlsx.load>[0];
  await read.xlsx.load(buffer as unknown as LoadArg);
  const ws = read.getWorksheet("Cash flow");
  assert.ok(ws);

  const labels = ws.getColumn(1).values.map((v) => (typeof v === "string" ? v : ""));
  for (const expected of [
    "Balance",
    "Income",
    "Total Income",
    "Expenses",
    "Total Expenses",
    "Net Income",
    "Closing Balance",
  ]) {
    assert.ok(labels.includes(expected), `the sheet must have a "${expected}" row`);
  }

  const totalIncomeRow = ws.getRow(labels.indexOf("Total Income"));
  const cell = totalIncomeRow.getCell(2);
  assert.ok(
    typeof cell.value === "object" && cell.value !== null && "formula" in cell.value,
    "totals must be formulas so added lines are picked up",
  );
});
