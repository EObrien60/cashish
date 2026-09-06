/**
 * Contracts: the agreement a billing schedule bills for.
 *
 * What matters is that a contract totals what has actually been raised against
 * it — including the invoices a schedule raises without anyone touching them —
 * and that it refuses to state a remaining value it cannot know.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import { asTenant, makeTenant, closePool, seeded } from "./harness";
import { db, schema } from "@cashish/core/db";
import { createCustomer } from "../src/lib/customers";
import { createInvoice, recordPayment } from "../src/lib/invoices";
import { saveRecurring, generateDue } from "../src/lib/recurring";
import {
  saveContract,
  listContracts,
  getContract,
  setContractStatus,
  deleteContract,
  attachDocument,
  getDocument,
  committedButUninvoiced,
} from "../src/lib/contracts";

let tenant: string;
let customerId: string;

before(async () => {
  tenant = (await makeTenant("contracts")).id;
  customerId = (await asTenant(tenant, () => createCustomer({ name: "Breakthrough Maths" })))
    .customer.id;
});
after(closePool);

const reset = () =>
  asTenant(tenant, async () => {
    await db.delete(schema.payments).where(eq(schema.payments.tenantId, tenant));
    await db.delete(schema.invoiceLines).where(eq(schema.invoiceLines.tenantId, tenant));
    await db.delete(schema.invoices).where(eq(schema.invoices.tenantId, tenant));
    await db
      .delete(schema.recurringInvoiceLines)
      .where(eq(schema.recurringInvoiceLines.tenantId, tenant));
    await db.delete(schema.recurringInvoices).where(eq(schema.recurringInvoices.tenantId, tenant));
    await db.delete(schema.contracts).where(eq(schema.contracts.tenantId, tenant));
  });

const line = (unitPrice: number) => ({
  description: "Development",
  quantity: 1,
  unitPrice,
  vatRateId: seeded(tenant, "vat-standard"),
});

test("a contract totals the invoices raised against it", async () => {
  await reset();
  const id = await asTenant(tenant, () =>
    saveContract({
      customerId,
      name: "BTM platform, year one",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      value: 60000,
    }),
  );

  await asTenant(tenant, () =>
    createInvoice({ customerId, issueDate: "2026-01-14", status: "sent", contractId: id, lines: [line(2500)] }),
  );
  await asTenant(tenant, () =>
    createInvoice({ customerId, issueDate: "2026-02-04", status: "sent", contractId: id, lines: [line(5000)] }),
  );
  // Raised for the same customer but NOT under this contract.
  await asTenant(tenant, () =>
    createInvoice({ customerId, issueDate: "2026-02-10", status: "sent", lines: [line(999)] }),
  );

  const [contract] = await asTenant(tenant, () => listContracts());
  assert.equal(contract.invoiceCount, 2, "only what was raised under it");
  assert.equal(contract.invoiced, 9225, "2,500 + 5,000 plus VAT at 23%");
  assert.equal(contract.remaining, 50775);
  assert.equal(contract.received, 0);
});

test("received is what was actually paid, not what was billed", async () => {
  const [before] = await asTenant(tenant, () => listContracts());
  const invoice = (await asTenant(tenant, () => getContract(before.id)))!.invoices[0];
  await asTenant(tenant, () =>
    recordPayment(invoice.id, { date: "2026-03-01", amount: 3075, method: "bank" }),
  );

  const [after] = await asTenant(tenant, () => listContracts());
  assert.equal(after.received, 3075);
  assert.equal(after.invoiced, 9225, "billing and collecting are different questions");
});

test("an open-ended contract does not invent a remaining value", async () => {
  await reset();
  await asTenant(tenant, () =>
    saveContract({
      customerId,
      name: "Support retainer",
      startDate: "2026-01-01",
      endDate: null,
      value: null,
    }),
  );
  await asTenant(tenant, () =>
    createInvoice({ customerId, issueDate: "2026-01-31", status: "sent", lines: [line(2000)] }),
  );

  const [contract] = await asTenant(tenant, () => listContracts());
  assert.equal(contract.value, null);
  assert.equal(contract.remaining, null, "a retainer bills whatever it bills");
  assert.equal(contract.endDate, null);
});

test("invoices a schedule raises belong to the schedule's contract", async () => {
  await reset();
  const contractId = await asTenant(tenant, () =>
    saveContract({ customerId, name: "Monthly retainer", startDate: "2026-01-01", value: 24000 }),
  );

  await asTenant(tenant, () =>
    saveRecurring({
      name: "Monthly",
      customerId,
      contractId,
      frequency: "monthly",
      interval: 1,
      startDate: "2026-01-01",
      dueDays: 30,
      autoSend: true,
      lines: [line(2000)],
    }),
  );

  // Three months later, nobody has touched anything.
  const generated = await asTenant(tenant, () => generateDue("2026-03-15"));
  assert.equal(generated.generated, 3);

  const [contract] = await asTenant(tenant, () => listContracts());
  assert.equal(contract.scheduleCount, 1);
  assert.equal(contract.invoiceCount, 3, "the schedule's invoices are the contract's invoices");
  assert.equal(contract.invoiced, 7380, "3 × 2,000 plus VAT");
  assert.equal(contract.remaining, 16620);
});

test("a contract past its end date while still active is flagged", async () => {
  await reset();
  await asTenant(tenant, () =>
    saveContract({
      customerId,
      name: "Finished last year",
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      value: 1000,
    }),
  );
  const [contract] = await asTenant(tenant, () => listContracts());
  assert.equal(contract.expired, true, "it has run out and nobody has said so");

  await asTenant(tenant, () => setContractStatus(contract.id, "completed"));
  const open = await asTenant(tenant, () => listContracts());
  assert.equal(open.length, 0, "a completed contract is out of the way by default");
  const all = await asTenant(tenant, () => listContracts({ includeClosed: true }));
  assert.equal(all.length, 1, "but not gone");
});

test("what is committed but not yet invoiced is reported, not guessed at", async () => {
  await reset();
  await asTenant(tenant, () =>
    saveContract({ customerId, name: "Signed, unbilled", startDate: "2026-01-01", value: 60000 }),
  );
  await asTenant(tenant, () =>
    saveContract({ customerId, name: "Open retainer", startDate: "2026-01-01", value: null }),
  );

  const committed = await asTenant(tenant, () => committedButUninvoiced());
  assert.equal(committed.total, 60000);
  assert.equal(committed.contracts.length, 1, "a retainer has no committed remainder to report");
  assert.equal(committed.contracts[0].name, "Signed, unbilled");
});

test("the signed document is stored and comes back", async () => {
  await reset();
  const id = await asTenant(tenant, () =>
    saveContract({ customerId, name: "With paperwork", startDate: "2026-01-01", value: 5000 }),
  );

  await asTenant(tenant, () =>
    attachDocument(id, {
      name: "signed-contract.pdf",
      type: "application/pdf",
      bytes: Buffer.from("%PDF-1.4 pretend"),
    }),
  );

  const [contract] = await asTenant(tenant, () => listContracts());
  assert.equal(contract.hasDocument, true);

  const doc = await asTenant(tenant, () => getDocument(id));
  assert.ok(doc);
  assert.equal(doc.name, "signed-contract.pdf");
  assert.equal(doc.mime, "application/pdf");
  assert.equal(doc.bytes.toString(), "%PDF-1.4 pretend");
});

test("deleting a contract leaves its invoices alone", async () => {
  await reset();
  const id = await asTenant(tenant, () =>
    saveContract({ customerId, name: "To be deleted", startDate: "2026-01-01", value: 1000 }),
  );
  await asTenant(tenant, () =>
    createInvoice({ customerId, issueDate: "2026-01-05", status: "sent", contractId: id, lines: [line(500)] }),
  );

  await asTenant(tenant, () => deleteContract(id));

  const invoices = await asTenant(tenant, () =>
    db.select().from(schema.invoices).where(eq(schema.invoices.tenantId, tenant)),
  );
  assert.equal(invoices.length, 1, "the money was still invoiced; only the agreement is gone");
  assert.equal(invoices[0].contractId, null, "and it no longer points at nothing");
});

test("a contract belongs to one book and is invisible from another", async () => {
  const other = (await makeTenant("contracts-other")).id;
  const mine = await asTenant(tenant, () =>
    saveContract({ customerId, name: "Mine", startDate: "2026-01-01", value: 100 }),
  );
  const seen = await asTenant(other, () => getContract(mine));
  assert.equal(seen, null);
  assert.equal((await asTenant(other, () => listContracts())).length, 0);
});
