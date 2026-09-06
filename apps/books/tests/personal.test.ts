/**
 * Personal mode: a book with the trading half switched off and envelopes on.
 *
 * The two things that would quietly ruin it are asserted here: a personal
 * Revolut export has no ID column, so re-importing the same file must not
 * duplicate the ledger; and a budget must be judged against the same
 * transactions every other report reads, never a stored copy of them.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import { asTenant, makeTenant, closePool } from "./harness";
import { db, schema } from "@cashish/core/db";
import { parseStatementCsv } from "../src/lib/import";
import { importTransactions } from "../src/lib/transactions";
import { budgetForMonth, setBudget, copyBudget, shiftMonth } from "../src/lib/budgets";
import { createTenant } from "../src/db/seed";
import { uid } from "../src/lib/id";

let tenant: string;

before(async () => {
  tenant = (await makeTenant("personal")).id;
});
after(closePool);

const reset = () =>
  asTenant(tenant, async () => {
    await db.delete(schema.budgets).where(eq(schema.budgets.tenantId, tenant));
    await db.delete(schema.transactions).where(eq(schema.transactions.tenantId, tenant));
  });

// A personal Revolut export: no ID column, and "Product" instead of "Account".
const PERSONAL_CSV = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-08-02 09:14:11,2026-08-02 11:02:00,Tesco Galway,-42.15,0.00,EUR,COMPLETED,1957.85
CARD_PAYMENT,Current,2026-08-02 13:30:00,2026-08-02 13:31:00,Insomnia Coffee,-3.50,0.00,EUR,COMPLETED,1954.35
CARD_PAYMENT,Current,2026-08-02 17:45:00,2026-08-02 17:46:00,Insomnia Coffee,-3.50,0.00,EUR,COMPLETED,1950.85
TRANSFER,Current,2026-08-25 08:00:00,2026-08-25 08:00:00,Salary August,3200.00,0.00,EUR,COMPLETED,5151.85
`;

test("a personal export with no ID column still parses", () => {
  const result = parseStatementCsv(PERSONAL_CSV);
  assert.equal(result.errors.length, 0, result.errors.join("; "));
  assert.equal(result.rows.length, 4);
  assert.ok(
    result.rows.every((r) => r.id.startsWith("csv_")),
    "ids must be derived and marked as such",
  );
  assert.equal(result.rows[0].bookedDate, "2026-08-02");
  assert.equal(result.rows[0].amount, -42.15);
  assert.equal(result.rows[3].amount, 3200);
});

test("two identical coffees on one day are two transactions, not one", () => {
  const rows = parseStatementCsv(PERSONAL_CSV).rows;
  const coffees = rows.filter((r) => r.description === "Insomnia Coffee");
  assert.equal(coffees.length, 2);
  assert.notEqual(coffees[0].id, coffees[1].id, "the running balance must separate them");
});

test("re-importing the same personal statement inserts nothing the second time", async () => {
  await reset();
  const rows = parseStatementCsv(PERSONAL_CSV).rows;

  const first = await asTenant(tenant, () => importTransactions(rows, []));
  const second = await asTenant(tenant, () => importTransactions(parseStatementCsv(PERSONAL_CSV).rows, []));

  assert.equal(first.inserted, 4);
  assert.equal(second.inserted, 0, "a re-upload must be a no-op, not a duplicate ledger");

  const count = await asTenant(tenant, async () =>
    (await db.select().from(schema.transactions).where(eq(schema.transactions.tenantId, tenant)))
      .length,
  );
  assert.equal(count, 4);
});

test("a budget is measured against the ledger, and going over is visible", async () => {
  await reset();
  const groceries = `${tenant}:cat-misc`; // any real category on this tenant
  const spend = async (amount: number, date: string) =>
    asTenant(tenant, async () => {
      await db.insert(schema.transactions).values({
        id: uid(),
        tenantId: tenant,
        bookedDate: date,
        amount,
        description: "Shop",
        categoryId: groceries,
        importBatch: "test",
      });
    });

  await spend(-120, "2026-08-04");
  await spend(-95, "2026-08-19");
  await asTenant(tenant, () => setBudget({ categoryId: groceries, month: "2026-08", amount: 200 }));

  const august = await asTenant(tenant, () => budgetForMonth("2026-08"));
  const line = august.expenses.find((l) => l.categoryId === groceries);
  assert.ok(line);
  assert.equal(line.budget, 200);
  assert.equal(line.actual, 215);
  assert.equal(line.remaining, -15, "overspend is negative remaining");
  assert.equal(line.usedPct, 107.5);
  assert.equal(august.totals.actualExpense, 215);
});

test("spending outside the window is not counted against the month", async () => {
  await reset();
  const cat = `${tenant}:cat-misc`;
  await asTenant(tenant, async () => {
    await db.insert(schema.transactions).values({
      id: uid(),
      tenantId: tenant,
      bookedDate: "2026-09-01",
      amount: -500,
      description: "September shop",
      categoryId: cat,
      importBatch: "test",
    });
    await setBudget({ categoryId: cat, month: "2026-08", amount: 200 });
  });

  const august = await asTenant(tenant, () => budgetForMonth("2026-08"));
  const line = august.expenses.find((l) => l.categoryId === cat);
  assert.ok(line);
  assert.equal(line.actual, 0);
  assert.equal(line.remaining, 200);
});

test("uncategorised spending is surfaced, not silently dropped", async () => {
  await reset();
  await asTenant(tenant, async () => {
    await db.insert(schema.transactions).values({
      id: uid(),
      tenantId: tenant,
      bookedDate: "2026-08-11",
      amount: -60,
      description: "Who knows",
      importBatch: "test",
    });
  });

  const august = await asTenant(tenant, () => budgetForMonth("2026-08"));
  assert.equal(august.totals.unbudgetedSpend, 60);
});

test("setting a budget twice updates it rather than doubling it", async () => {
  await reset();
  const cat = `${tenant}:cat-misc`;
  await asTenant(tenant, async () => {
    await setBudget({ categoryId: cat, month: "2026-08", amount: 200 });
    await setBudget({ categoryId: cat, month: "2026-08", amount: 250 });
  });

  const rows = await asTenant(tenant, () =>
    db.select().from(schema.budgets).where(eq(schema.budgets.tenantId, tenant)),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 250);
});

test("a zero budget removes the line", async () => {
  await reset();
  const cat = `${tenant}:cat-misc`;
  await asTenant(tenant, async () => {
    await setBudget({ categoryId: cat, month: "2026-08", amount: 200 });
    await setBudget({ categoryId: cat, month: "2026-08", amount: 0 });
  });
  const rows = await asTenant(tenant, () =>
    db.select().from(schema.budgets).where(eq(schema.budgets.tenantId, tenant)),
  );
  assert.equal(rows.length, 0);
});

test("copying a month forward is idempotent", async () => {
  await reset();
  const cat = `${tenant}:cat-misc`;
  await asTenant(tenant, () => setBudget({ categoryId: cat, month: "2026-08", amount: 200 }));

  const next = shiftMonth("2026-08", 1);
  await asTenant(tenant, () => copyBudget("2026-08", next));
  await asTenant(tenant, () => copyBudget("2026-08", next));

  const rows = await asTenant(tenant, () =>
    db.select().from(schema.budgets).where(eq(schema.budgets.tenantId, tenant)),
  );
  assert.equal(rows.filter((r) => r.month === next).length, 1, "copying twice must not duplicate");
  assert.equal(rows.find((r) => r.month === next)?.amount, 200);
});

test("shiftMonth crosses a year in both directions", () => {
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
});

test("a personal tenant is seeded with envelopes, a business one with a chart of accounts", async () => {
  const personalId = await createTenant({
    slug: `test-personal-${uid().slice(0, 8)}`,
    name: "Household",
    kind: "personal",
  });

  const [row] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, personalId));
  assert.equal(row.kind, "personal");
  assert.equal(row.region, "IE");
  assert.equal(row.currency, "EUR");

  const cats = await db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.tenantId, personalId));
  const names = cats.map((c) => c.name);
  assert.ok(names.includes("Groceries"), "a household budgets groceries");
  assert.ok(!names.includes("Cost of sales"), "and does not have a cost of sales");
});

test("a UK book gets UK VAT rates and sterling", async () => {
  const ukId = await createTenant({
    slug: `test-uk-${uid().slice(0, 8)}`,
    name: "UK Ltd",
    region: "GB",
  });

  const [row] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, ukId));
  assert.equal(row.region, "GB");
  assert.equal(row.currency, "GBP");

  const rates = await db
    .select()
    .from(schema.vatRates)
    .where(eq(schema.vatRates.tenantId, ukId));
  const standard = rates.find((r) => r.isDefault);
  assert.equal(standard?.rate, 0.2, "the UK standard rate is 20%, not 23%");
  assert.ok(!rates.some((r) => r.rate === 0.09), "there is no second reduced rate in the UK");

  // Every category must still point at a rate that exists on this tenant.
  const cats = await db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.tenantId, ukId));
  const rateIds = new Set(rates.map((r) => r.id));
  for (const c of cats) {
    assert.ok(
      c.defaultVatRateId && rateIds.has(c.defaultVatRateId),
      `${c.name} points at a VAT rate this tenant does not have`,
    );
  }
});

test("existing books are untouched: the default is a business in Ireland", async () => {
  const [row] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenant));
  assert.equal(row.kind, "business");
  assert.equal(row.region, "IE");
  assert.equal(row.currency, "EUR");
});
