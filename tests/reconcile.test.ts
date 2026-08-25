/**
 * Matching bank inflows to invoices.
 *
 * The case that matters is the boring one: a client on a monthly retainer pays five
 * identical amounts against five identical invoices. Scored independently every payment
 * points at the same invoice and the other four look unpaid, which is exactly the
 * situation where a person needs the tool to be right.
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
const { createCustomer } = require("../src/lib/customers") as typeof import("../src/lib/customers");
const { createInvoice } = require("../src/lib/invoices") as typeof import("../src/lib/invoices");
const { reconcileReport } = require("../src/lib/reconcile") as typeof import("../src/lib/reconcile");
const { uid } = require("../src/lib/id") as typeof import("../src/lib/id");

boot();

const reset = () => {
  db.delete(schema.payments).run();
  db.delete(schema.invoiceLines).run();
  db.delete(schema.invoices).run();
  db.delete(schema.transactions).run();
};

const inflow = (description: string, amount: number, bookedDate: string) => {
  const id = uid();
  db.insert(schema.transactions)
    .values({ id, bookedDate, amount, description, payer: description, importBatch: uid() })
    .run();
  return id;
};

test("identical repeat payments are matched one-to-one, not all to the same invoice", () => {
  reset();
  const { customer } = createCustomer({ name: "Repeat Client" });

  // Five identical monthly invoices.
  const numbers = ["2001", "2002", "2003", "2004", "2005"];
  for (const [index, number] of numbers.entries()) {
    createInvoice({
      customerId: customer.id,
      number,
      status: "sent",
      issueDate: `2026-0${index + 3}-01`,
      dueDate: `2026-0${index + 4}-01`,
      lines: [{ description: "Monthly retainer", quantity: 1, unitPrice: 7000, vatRateId: null, productId: null }],
    });
  }

  // Five identical payments arrive.
  for (let i = 0; i < 5; i++) inflow("From REPEAT CLIENT", 7000, `2026-0${i + 3}-15`);

  const report = reconcileReport();
  assert.equal(report.confidentMatches.length, 5, "every payment should find a home");

  const claimed = report.confidentMatches.map((m) => m.candidates[0]?.number);
  assert.equal(new Set(claimed).size, 5, "and they must be five different invoices");
  assert.deepEqual([...claimed].sort(), numbers, "oldest invoice settled first");
});

test("a payment with nothing to match is reported as needing an invoice", () => {
  reset();
  const { customer } = createCustomer({ name: "Known Client" });
  createInvoice({
    customerId: customer.id,
    number: "3001",
    status: "sent",
    issueDate: "2026-05-01",
    lines: [{ description: "Work", quantity: 1, unitPrice: 500, vatRateId: null, productId: null }],
  });
  inflow("From KNOWN CLIENT", 500, "2026-05-10");
  inflow("From SOMEONE ELSE ENTIRELY", 12345.67, "2026-05-11");

  const report = reconcileReport();
  assert.equal(report.confidentMatches.length, 1);
  assert.equal(report.needsInvoice.length, 1);
  assert.equal(report.needsInvoice[0]?.amount, 12345.67);
});

test("one invoice cannot be claimed by two payments", () => {
  reset();
  const { customer } = createCustomer({ name: "Single Invoice Client" });
  createInvoice({
    customerId: customer.id,
    number: "4001",
    status: "sent",
    issueDate: "2026-06-01",
    lines: [{ description: "Work", quantity: 1, unitPrice: 1000, vatRateId: null, productId: null }],
  });
  // Two payments of the same amount, only one invoice to explain either.
  inflow("From SINGLE INVOICE CLIENT", 1000, "2026-06-10");
  inflow("From SINGLE INVOICE CLIENT", 1000, "2026-06-11");

  const report = reconcileReport();
  assert.equal(report.confidentMatches.length, 1, "only one can claim it");
  const leftover = [...report.needsDecision, ...report.needsInvoice.map((t) => ({ transaction: t, candidates: [] }))];
  assert.equal(leftover.length, 1, "the other is left for a person to explain");
});
