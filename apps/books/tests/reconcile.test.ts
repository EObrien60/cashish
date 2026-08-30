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
import { db, schema } from "@cashish/core/db";
import { createCustomer } from "../src/lib/customers";
import { createInvoice, getInvoice } from "../src/lib/invoices";
import { applyBatchMatch, reconcileReport } from "../src/lib/reconcile";
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

test("money that arrived before an invoice existed is not offered as its payment", async () => {
  await reset();
  await asTenant(tenant, async () => {
    const { customer } = await createCustomer({ name: "Time Travel Client" });
    await createInvoice({
      customerId: customer.id,
      number: "5001",
      status: "sent",
      issueDate: "2026-06-01",
      lines: [{ description: "Work", quantity: 1, unitPrice: 1000, vatRateId: null, productId: null }],
    });

    // Exactly the right amount and the right name — but a year too early.
    await inflow("From TIME TRAVEL CLIENT", 1000, "2025-06-01");
    const early = await reconcileReport();
    assert.equal(
      early.confidentMatches.length,
      0,
      "an inflow predating the invoice must never be a confident match",
    );
    assert.equal(early.needsInvoice.length, 1, "it is unexplained money, not a payment");

    // The same inflow after the issue date is matched.
    await inflow("From TIME TRAVEL CLIENT", 1000, "2026-06-15");
    const later = await reconcileReport();
    assert.equal(later.confidentMatches.length, 1);
    assert.equal(later.confidentMatches[0]?.transaction.date, "2026-06-15");
  });
});

/*
 * Batch payments.
 *
 * Modelled on a real client's ledger. They run a monthly retainer and buy hardware
 * ad hoc, then settle the lot in one transfer: each payment is that month's retainer
 * plus whatever else was outstanding. Nine invoices, five transfers.
 *
 * One-to-one matching cannot express that, and the failure is not merely "three
 * transfers go unmatched". Because the retainers are identical, the two lone
 * retainer-sized transfers get handed to the OLDEST unclaimed retainer invoice —
 * which is one the earlier batch already paid. So the money lands on the wrong rows
 * and the invoices it actually settled still look open. Nothing shows as an error;
 * the ledger is simply wrong.
 */
const JRH_INVOICES: [string, string, number][] = [
  ["1010", "2025-07-17", 1375.14],
  ["1011", "2025-07-21", 768.75],
  ["1013", "2025-07-25", 1525.2],
  ["1052", "2025-08-10", 645.75],
  ["1053", "2025-08-25", 1525.2],
  ["1058", "2025-09-25", 1378.81],
  ["1059", "2025-09-25", 1525.2],
  ["1061", "2025-10-28", 1525.2],
  ["1062", "2025-11-25", 1525.2],
];

// The three batches, then two months paid on their own.
const JRH_INFLOWS: [string, number][] = [
  ["2025-07-30", 3669.0], // 1010 + 1011 + 1013, nine cent short
  ["2025-08-27", 2170.95], // 1052 + 1053
  ["2025-10-02", 2904.01], // 1058 + 1059
  ["2025-11-26", 1525.2], // 1061
  ["2025-12-17", 1525.2], // 1062
];

async function batchClient() {
  const { customer } = await createCustomer({ name: "J Ryan Haulage Limited" });
  for (const [number, issueDate, total] of JRH_INVOICES) {
    await createInvoice({
      customerId: customer.id,
      number,
      status: "sent",
      issueDate,
      lines: [{ description: "Work", quantity: 1, unitPrice: total, vatRateId: null, productId: null }],
    });
  }
  for (const [date, amount] of JRH_INFLOWS) {
    await inflow("Money added from J. RYAN HAULAGE LIMITED", amount, date);
  }
  return customer;
}

test("a transfer settling several invoices is offered as one batch", async () => {
  await reset();
  await asTenant(tenant, async () => {
    await batchClient();
    const report = await reconcileReport();

    const sets = report.batchMatches.map((b) => ({
      date: b.transaction.date,
      numbers: b.invoices.map((i) => i.number).sort(),
      shortfall: b.shortfall,
    }));
    assert.deepEqual(
      sets,
      [
        { date: "2025-07-30", numbers: ["1010", "1011", "1013"], shortfall: 0.09 },
        { date: "2025-08-27", numbers: ["1052", "1053"], shortfall: 0 },
        { date: "2025-10-02", numbers: ["1058", "1059"], shortfall: 0 },
      ],
      "each batch is the exact set of invoices it settles, with any shortfall stated",
    );
  });
});

test("the lone retainer payments settle the retainers a batch has not already paid", async () => {
  await reset();
  await asTenant(tenant, async () => {
    await batchClient();
    const report = await reconcileReport();

    // The report lists newest money first; what matters here is which invoice each
    // transfer settled, so compare in date order.
    const claimed = report.confidentMatches
      .map((m) => ({ date: m.transaction.date, number: m.candidates[0]?.number }))
      .sort((a, b) => a.date.localeCompare(b.date));
    assert.deepEqual(
      claimed,
      [
        { date: "2025-11-26", number: "1061" },
        { date: "2025-12-17", number: "1062" },
      ],
      "1013 and 1053 belong to the July and August batches, so this money cannot take them",
    );
  });
});

test("nothing is reported twice: every transfer is explained exactly once", async () => {
  await reset();
  await asTenant(tenant, async () => {
    await batchClient();
    const report = await reconcileReport();
    const seen = [
      ...report.confidentMatches.map((m) => m.transaction.id),
      ...report.needsDecision.map((m) => m.transaction.id),
      ...report.needsInvoice.map((t) => t.id),
      ...report.batchMatches.map((b) => b.transaction.id),
    ];
    assert.equal(seen.length, JRH_INFLOWS.length, "one bucket each");
    assert.equal(new Set(seen).size, JRH_INFLOWS.length, "and no transfer in two buckets");
  });
});

test("a batch is only proposed when no single invoice explains the money", async () => {
  await reset();
  await asTenant(tenant, async () => {
    const { customer } = await createCustomer({ name: "Tidy Client" });
    // Two invoices where one happens to equal the sum of nothing else, plus a
    // payment that matches one of them exactly.
    for (const [number, total] of [["6001", 300], ["6002", 700], ["6003", 1000]] as [string, number][]) {
      await createInvoice({
        customerId: customer.id,
        number,
        status: "sent",
        issueDate: "2026-01-01",
        lines: [{ description: "Work", quantity: 1, unitPrice: total, vatRateId: null, productId: null }],
      });
    }
    // 1000 could be 6003 alone, or 6001 + 6002. The single must win.
    await inflow("From TIDY CLIENT", 1000, "2026-01-15");

    const report = await reconcileReport();
    assert.equal(report.batchMatches.length, 0, "an exact single invoice is never split into a batch");
    assert.equal(report.confidentMatches[0]?.candidates[0]?.number, "6003");
  });
});

test("a batch cannot include an invoice raised after the money arrived", async () => {
  await reset();
  await asTenant(tenant, async () => {
    const { customer } = await createCustomer({ name: "Late Invoice Client" });
    await createInvoice({
      customerId: customer.id,
      number: "7001",
      status: "sent",
      issueDate: "2026-02-01",
      lines: [{ description: "Work", quantity: 1, unitPrice: 400, vatRateId: null, productId: null }],
    });
    await createInvoice({
      customerId: customer.id,
      number: "7002",
      status: "sent",
      issueDate: "2026-03-20", // after the transfer below
      lines: [{ description: "Work", quantity: 1, unitPrice: 600, vatRateId: null, productId: null }],
    });
    await inflow("From LATE INVOICE CLIENT", 1000, "2026-03-01");

    const report = await reconcileReport();
    assert.equal(report.batchMatches.length, 0, "7002 did not exist yet, so 400 + 600 is not a batch");
  });
});

test("applying a batch settles oldest first and leaves the shortfall on the newest", async () => {
  await reset();
  await asTenant(tenant, async () => {
    await batchClient();
    const report = await reconcileReport();
    const july = report.batchMatches.find((b) => b.transaction.date === "2025-07-30")!;

    const result = await applyBatchMatch(
      july.transaction.id,
      july.invoices.map((i) => i.invoiceId),
    );
    assert.deepEqual(
      result.written,
      [
        { number: "1010", amount: 1375.14 },
        { number: "1011", amount: 768.75 },
        { number: "1013", amount: 1525.11 }, // nine cent short
      ],
      "the transfer is spread across the set in issue order",
    );
    assert.equal(result.unallocated, 0, "and all of the money is used");

    const settled = await Promise.all(
      july.invoices.map(async (i) => {
        const inv = await getInvoice(i.invoiceId);
        return { number: inv!.number, status: inv!.status };
      }),
    );
    assert.deepEqual(
      settled.sort((a, b) => a.number.localeCompare(b.number)),
      [
        { number: "1010", status: "paid" },
        { number: "1011", status: "paid" },
        { number: "1013", status: "partial" },
      ],
      "only the newest invoice of the set is left short",
    );

    // The transfer is now explained, so it stops being offered.
    const after = await reconcileReport();
    assert.equal(
      after.batchMatches.some((b) => b.transaction.id === july.transaction.id),
      false,
      "a settled transfer is no longer an unmatched inflow",
    );
    assert.equal(
      after.confidentMatches.some((m) => m.transaction.id === july.transaction.id),
      false,
    );
  });
});

test("a batch refuses money out, a lone invoice, and an invoice raised too late", async () => {
  await reset();
  await asTenant(tenant, async () => {
    const { customer } = await createCustomer({ name: "Guard Client" });
    const ids: string[] = [];
    for (const [number, issueDate, total] of [
      ["8001", "2026-01-01", 100],
      ["8002", "2026-06-01", 200],
    ] as [string, string, number][]) {
      const inv = await createInvoice({
        customerId: customer.id,
        number,
        status: "sent",
        issueDate,
        lines: [{ description: "Work", quantity: 1, unitPrice: total, vatRateId: null, productId: null }],
      });
      ids.push(inv!.id);
    }
    const good = await inflow("From GUARD CLIENT", 300, "2026-06-10");
    const paidOut = await asTenant(tenant, async () => {
      const id = uid();
      await db.insert(schema.transactions).values({
        id,
        tenantId: tenant,
        bookedDate: "2026-06-10",
        amount: -300,
        description: "To GUARD CLIENT",
        importBatch: uid(),
      });
      return id;
    });
    const early = await inflow("From GUARD CLIENT", 300, "2026-02-01");

    await assert.rejects(() => applyBatchMatch(paidOut, ids), /money out/);
    await assert.rejects(() => applyBatchMatch(good, [ids[0]!]), /at least two/);
    await assert.rejects(() => applyBatchMatch(good, [ids[0]!, uid()]), /does not exist/);
    await assert.rejects(() => applyBatchMatch(early, ids), /after this money arrived/);

    // The legitimate one goes through.
    const ok = await applyBatchMatch(good, ids);
    assert.deepEqual(ok.written, [
      { number: "8001", amount: 100 },
      { number: "8002", amount: 200 },
    ]);
  });
});
