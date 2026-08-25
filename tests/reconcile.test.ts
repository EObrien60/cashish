/**
 * Matching bank inflows to invoices.
 *
 * The case that matters is the boring one: a client on a monthly retainer pays five
 * identical amounts against five identical invoices. Scored independently every payment
 * points at the same invoice and the other four look unpaid, which is exactly the
 * situation where a person needs the tool to be right.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import { asTenant, makeTenant, closePool } from "./harness";
import { db, schema } from "../src/db/client";
import { createCustomer } from "../src/lib/customers";
import { createInvoice } from "../src/lib/invoices";
import { reconcileReport } from "../src/lib/reconcile";
import { uid } from "../src/lib/id";

let tenant: string;

before(async () => {
  tenant = (await makeTenant("reconcile")).id;
});
after(closePool);

const reset = () =>
  asTenant(tenant, async () => {
    // Order matters: payments and lines reference invoices.
    await db.delete(schema.payments).where(eq(schema.payments.tenantId, tenant));
    await db.delete(schema.invoiceLines).where(eq(schema.invoiceLines.tenantId, tenant));
    await db.delete(schema.invoices).where(eq(schema.invoices.tenantId, tenant));
    await db.delete(schema.transactions).where(eq(schema.transactions.tenantId, tenant));
  });

const inflow = (description: string, amount: number, bookedDate: string) =>
  asTenant(tenant, async () => {
    const id = uid();
    await db.insert(schema.transactions).values({
      id,
      tenantId: tenant,
      bookedDate,
      amount,
      description,
      payer: description,
      importBatch: uid(),
    });
    return id;
  });

test("identical repeat payments are matched one-to-one, not all to the same invoice", async () => {
  await reset();
  await asTenant(tenant, async () => {
    const { customer } = await createCustomer({ name: "Repeat Client" });

    // Five identical monthly invoices.
    const numbers = ["2001", "2002", "2003", "2004", "2005"];
    for (const [index, number] of numbers.entries()) {
      await createInvoice({
        customerId: customer.id,
        number,
        status: "sent",
        issueDate: `2026-0${index + 3}-01`,
        dueDate: `2026-0${index + 4}-01`,
        lines: [
          { description: "Monthly retainer", quantity: 1, unitPrice: 7000, vatRateId: null, productId: null },
        ],
      });
    }

    // Five identical payments arrive.
    for (let i = 0; i < 5; i++) await inflow("From REPEAT CLIENT", 7000, `2026-0${i + 3}-15`);

    const report = await reconcileReport();
    assert.equal(report.confidentMatches.length, 5, "every payment should find a home");

    const claimed = report.confidentMatches.map((m) => m.candidates[0]?.number);
    assert.equal(new Set(claimed).size, 5, "and they must be five different invoices");
    assert.deepEqual([...claimed].sort(), numbers, "oldest invoice settled first");
  });
});

test("a payment with nothing to match is reported as needing an invoice", async () => {
  await reset();
  await asTenant(tenant, async () => {
    const { customer } = await createCustomer({ name: "Known Client" });
    await createInvoice({
      customerId: customer.id,
      number: "3001",
      status: "sent",
      issueDate: "2026-05-01",
      lines: [{ description: "Work", quantity: 1, unitPrice: 500, vatRateId: null, productId: null }],
    });
    await inflow("From KNOWN CLIENT", 500, "2026-05-10");
    await inflow("From SOMEONE ELSE ENTIRELY", 12345.67, "2026-05-11");

    const report = await reconcileReport();
    assert.equal(report.confidentMatches.length, 1);
    assert.equal(report.needsInvoice.length, 1);
    assert.equal(report.needsInvoice[0]?.amount, 12345.67);
  });
});

test("one invoice cannot be claimed by two payments", async () => {
  await reset();
  await asTenant(tenant, async () => {
    const { customer } = await createCustomer({ name: "Single Invoice Client" });
    await createInvoice({
      customerId: customer.id,
      number: "4001",
      status: "sent",
      issueDate: "2026-06-01",
      lines: [{ description: "Work", quantity: 1, unitPrice: 1000, vatRateId: null, productId: null }],
    });
    // Two payments of the same amount, only one invoice to explain either.
    await inflow("From SINGLE INVOICE CLIENT", 1000, "2026-06-10");
    await inflow("From SINGLE INVOICE CLIENT", 1000, "2026-06-11");

    const report = await reconcileReport();
    assert.equal(report.confidentMatches.length, 1, "only one can claim it");
    const leftover = [
      ...report.needsDecision,
      ...report.needsInvoice.map((t) => ({ transaction: t, candidates: [] })),
    ];
    assert.equal(leftover.length, 1, "the other is left for a person to explain");
  });
});
