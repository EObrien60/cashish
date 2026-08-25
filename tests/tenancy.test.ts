/**
 * Tenant isolation.
 *
 * Isolation is enforced in the query layer, not by Postgres RLS — that was a
 * deliberate choice, and it means the guarantee is only as good as this test.
 * Two tenants are given deliberately confusable data (same customer name, same
 * amounts, same dates) and every read a caller can reach is checked to return
 * only its own rows.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { asTenant, makeTenant, seeded, closePool } from "./harness";
import { db, schema } from "../src/db/client";
import { uid } from "../src/lib/id";
import { createCustomer, listCustomers } from "../src/lib/customers";
import { createInvoice, listInvoices, recordPayment } from "../src/lib/invoices";
import { listTransactions, transactionCounts } from "../src/lib/transactions";
import { saveRule, listRules } from "../src/lib/rules";
import { profitAndLoss, dashboardStats } from "../src/lib/reports";
import { computeVatReturn } from "../src/lib/vat";
import { reconcileReport } from "../src/lib/reconcile";
import { buildIntegrationSummary } from "../src/lib/integration";
import { listCategories, listVatRates, getSettings, listAllTransactions } from "../src/lib/lookups";
import { ctx } from "../src/db/context";

let a: string;
let b: string;

/** Same shape of book in both tenants, so a leak shows up as doubled numbers. */
async function populate(tenant: string, amount: number, label: string) {
  await asTenant(tenant, async () => {
    await db.insert(schema.transactions).values({
      id: uid(),
      tenantId: tenant,
      bookedDate: "2026-07-15",
      amount,
      description: `PAYMENT FROM ${label}`,
      payer: label,
      categoryId: seeded(tenant, "cat-sales"),
      vatRateId: seeded(tenant, "vat-standard"),
      importBatch: uid(),
    });
    await db.insert(schema.transactions).values({
      id: uid(),
      tenantId: tenant,
      bookedDate: "2026-07-16",
      amount: -amount / 2,
      description: `SUPPLIER ${label}`,
      categoryId: seeded(tenant, "cat-software"),
      vatRateId: seeded(tenant, "vat-standard"),
      importBatch: uid(),
    });
    // Identical customer name in both tenants — the confusable case.
    const { customer } = await createCustomer({ name: "Shared Name Ltd" });
    const invoice = await createInvoice({
      customerId: customer.id,
      number: "9001",
      status: "sent",
      issueDate: "2026-07-01",
      dueDate: "2026-07-31",
      lines: [{ description: "Work", quantity: 1, unitPrice: amount, vatRateId: null, productId: null }],
    });
    await recordPayment(invoice!.id, { date: "2026-07-20", amount: amount / 4 });
    await saveRule({
      name: `Rule ${label}`,
      matchField: "description",
      matchType: "contains",
      matchValue: label,
      direction: "any",
      categoryId: seeded(tenant, "cat-sales"),
      vatRateId: null,
      enabled: true,
    });
  });
}

before(async () => {
  a = (await makeTenant("iso-a")).id;
  b = (await makeTenant("iso-b")).id;
  await populate(a, 1000, "ALPHA");
  await populate(b, 4000, "BETA");
});
after(closePool);

test("every list read returns only the calling tenant's rows", async () => {
  for (const [tenant, amount, label] of [
    [a, 1000, "ALPHA"],
    [b, 4000, "BETA"],
  ] as const) {
    await asTenant(tenant, async () => {
      assert.equal((await listTransactions({ excluded: "all" })).length, 2, `${label}: transactions`);
      assert.equal((await listCustomers({ includeArchived: true })).length, 1, `${label}: customers`);
      assert.equal((await listInvoices()).length, 1, `${label}: invoices`);
      assert.equal((await listRules()).length, 1, `${label}: rules`);
      assert.equal((await listAllTransactions()).length, 2, `${label}: ledger`);

      // Seeded reference data is per tenant, not shared.
      assert.equal((await listVatRates()).length, 5, `${label}: vat rates`);
      assert.equal((await listCategories()).length, 15, `${label}: categories`);

      const rules = await listRules();
      assert.equal(rules[0]?.name, `Rule ${label}`, `${label}: sees its own rule`);
      assert.equal(rules[0]?.tenantId, tenant);

      const counts = await transactionCounts();
      assert.deepEqual(counts, { included: 2, excluded: 0, uncategorised: 0 }, `${label}: counts`);
    });
  }
});

test("every aggregate is computed from one tenant's rows only", async () => {
  await asTenant(a, async () => {
    const pnl = await profitAndLoss("2026-07-01", "2026-07-31");
    assert.equal(pnl.totalIncome, 1000, "alpha income excludes beta's 4000");
    assert.equal(pnl.totalExpense, 500);

    const stats = await dashboardStats("2026-07-01", "2026-07-31");
    assert.equal(stats.cashIn, 1000);
    assert.equal(stats.txCount, 2);

    const vat = await computeVatReturn("2026-07-01", "2026-09-30");
    // 500 gross out at 23% inclusive => 93.50 reclaimable.
    assert.equal(vat.t2_purchasesVat, 93.5);

    const summary = await buildIntegrationSummary("2026-07-31");
    assert.equal(summary.customers.length, 1);
    assert.equal(summary.totals.invoiced, 1000);
    assert.equal(summary.totals.received, 250);

    const report = await reconcileReport();
    // Alpha's own inflow of 1000 against its 750 still outstanding.
    assert.ok(report.unmatchedInflows <= 1, "only alpha's inflows are considered");

    const settings = await getSettings();
    assert.equal(settings.tenantId, a);
    assert.equal(settings.businessName, "Test iso-a");
  });

  await asTenant(b, async () => {
    const pnl = await profitAndLoss("2026-07-01", "2026-07-31");
    assert.equal(pnl.totalIncome, 4000, "beta income excludes alpha's 1000");
    assert.equal(pnl.totalExpense, 2000);
    const summary = await buildIntegrationSummary("2026-07-31");
    assert.equal(summary.totals.invoiced, 4000);
    assert.equal((await getSettings()).businessName, "Test iso-b");
  });
});

test("invoice numbers are per tenant, so both can hold 9001", async () => {
  const numbers = await Promise.all([
    asTenant(a, async () => (await listInvoices())[0]?.number),
    asTenant(b, async () => (await listInvoices())[0]?.number),
  ]);
  assert.deepEqual(numbers, ["9001", "9001"], "the same number in both books is legitimate");
});

test("a query outside a tenant context throws instead of reading everything", async () => {
  assert.throws(() => ctx(), /No tenant context/);
  await assert.rejects(() => listInvoices(), /No tenant context/);
  await assert.rejects(() => listTransactions(), /No tenant context/);
  await assert.rejects(() => profitAndLoss("2026-01-01", "2026-12-31"), /No tenant context/);
  await assert.rejects(() => buildIntegrationSummary(), /No tenant context/);
});

test("a second business starts empty, seeded, and isolated from the first", async () => {
  const { createTenant } = await import("../src/db/seed");
  const { uid } = await import("../src/lib/id");
  const fresh = await createTenant({ slug: `iso-new-${uid().slice(0, 8)}`, name: "Second Co" });

  await asTenant(fresh, async () => {
    // Its own copy of the reference data, not a view of anybody else's.
    assert.equal((await listVatRates()).length, 5);
    assert.equal((await listCategories()).length, 15);
    assert.equal((await getSettings()).businessName, "Second Co");

    // And no books at all, despite two populated tenants existing.
    assert.equal((await listTransactions({ excluded: "all" })).length, 0);
    assert.equal((await listInvoices()).length, 0);
    assert.equal((await listCustomers({ includeArchived: true })).length, 0);
    const pnl = await profitAndLoss("2026-01-01", "2026-12-31");
    assert.equal(pnl.totalIncome, 0);
    assert.equal(pnl.totalExpense, 0);
  });

  // And the originals are untouched by its existence.
  await asTenant(a, async () => {
    assert.equal((await listTransactions({ excluded: "all" })).length, 2);
    assert.equal((await profitAndLoss("2026-07-01", "2026-07-31")).totalIncome, 1000);
  });
});

test("invoice numbering restarts per business", async () => {
  const { createTenant } = await import("../src/db/seed");
  const { uid } = await import("../src/lib/id");
  const { createCustomer: mkCustomer } = await import("../src/lib/customers");
  const { createInvoice: mkInvoice } = await import("../src/lib/invoices");
  const fresh = await createTenant({ slug: `iso-num-${uid().slice(0, 8)}`, name: "Numbering Co" });

  await asTenant(fresh, async () => {
    const { customer } = await mkCustomer({ name: "First Client" });
    const invoice = await mkInvoice({
      customerId: customer.id,
      status: "draft",
      issueDate: "2026-08-01",
      lines: [{ description: "Work", quantity: 1, unitPrice: 100, vatRateId: null, productId: null }],
    });
    assert.equal(
      invoice?.number,
      "INV-0001",
      "a new business starts at 1, regardless of how many invoices exist elsewhere",
    );
  });
});
