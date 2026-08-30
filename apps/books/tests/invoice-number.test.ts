/**
 * Claiming an invoice number.
 *
 * The SQLite implementation read next_invoice_seq and wrote back seq + 1 inside
 * a transaction. Single-user on a local file that was safe. With a browser and
 * an MCP agent both connected, two invoices could read the same value and take
 * the same number — and two invoices sharing a number is the kind of bug an
 * accountant finds, not a test suite. It is now an atomic increment with
 * RETURNING, and this is the test that says so.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { asTenant, makeTenant, closePool } from "./harness";
import { createCustomer } from "../src/lib/customers";
import { createInvoice, listInvoices } from "../src/lib/invoices";

let tenant: string;
let customerId: string;

before(async () => {
  tenant = (await makeTenant("numbering")).id;
  await asTenant(tenant, async () => {
    const { customer } = await createCustomer({ name: "Concurrency Client" });
    customerId = customer.id;
  });
});
after(closePool);

test("concurrent invoice creation never issues the same number twice", async () => {
  const CONCURRENT = 12;
  await asTenant(tenant, async () => {
    const created = await Promise.all(
      Array.from({ length: CONCURRENT }, (_, i) =>
        createInvoice({
          customerId,
          status: "draft",
          issueDate: "2026-08-01",
          lines: [
            { description: `Line ${i}`, quantity: 1, unitPrice: 100, vatRateId: null, productId: null },
          ],
        }),
      ),
    );

    const numbers = created.map((inv) => inv!.number);
    assert.equal(numbers.length, CONCURRENT);
    assert.equal(
      new Set(numbers).size,
      CONCURRENT,
      `duplicate invoice numbers issued: ${numbers.sort().join(", ")}`,
    );

    // And the sequence advanced by exactly the number consumed — no gaps, no reuse.
    const all = await listInvoices();
    assert.equal(all.length, CONCURRENT);
    const seqs = numbers.map((n) => Number(n.replace("INV-", ""))).sort((x, y) => x - y);
    assert.deepEqual(
      seqs,
      Array.from({ length: CONCURRENT }, (_, i) => i + 1),
      "numbers are contiguous from 1",
    );
  });
});
