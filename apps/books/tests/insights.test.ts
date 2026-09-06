/**
 * The fact sheet a report is written from.
 *
 * The reason this is tested hard and the model is not: every number a generated
 * report states comes from here. If these are right, a wrong report is a
 * wording problem. If these are wrong, the report is confidently wrong about
 * somebody's money.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import { asTenant, makeTenant, closePool, seeded } from "./harness";
import { db, schema } from "@cashish/core/db";
import { uid } from "../src/lib/id";
import { buildFactSheet, merchantLabel, uncategorisedByMerchant } from "../src/lib/insights";
import { parseStatementCsv } from "../src/lib/import";
import { importTransactions } from "../src/lib/transactions";

let tenant: string;
before(async () => { tenant = (await makeTenant("insights")).id; });
after(closePool);

const reset = () => asTenant(tenant, async () => {
  await db.delete(schema.transactions).where(eq(schema.transactions.tenantId, tenant));
  await db.delete(schema.accounts).where(eq(schema.accounts.tenantId, tenant));
});

const tx = (description: string, amount: number, date: string, categoryId?: string) =>
  asTenant(tenant, async () => {
    await db.insert(schema.transactions).values({
      id: uid(), tenantId: tenant, bookedDate: date, amount, description,
      importBatch: "t", ...(categoryId ? { categoryId } : {}),
    });
  });

test("a merchant is folded to what it is, not what the terminal printed", () => {
  assert.equal(merchantLabel("Circle K Gas Station"), "Circle K Gas");
  assert.equal(merchantLabel("Insomnia Coffee Company"), "Insomnia Coffee Company");
  assert.equal(merchantLabel("Lidl 4471 Galway"), "Lidl Galway");
  assert.equal(merchantLabel("Hetzner Online GmbH"), "Hetzner Online");
  assert.equal(merchantLabel(""), "Unnamed");
});

test("totals, months and categories are the ledger's, to the cent", async () => {
  await reset();
  const groceries = seeded(tenant, "cat-cogs");
  await tx("Lidl", -45.23, "2026-08-06", groceries);
  await tx("Lidl", -46.16, "2026-08-13", groceries);
  await tx("Salary", 3200, "2026-08-01");
  await tx("Lidl", -51.31, "2026-09-20", groceries);

  const f = await asTenant(tenant, () => buildFactSheet({ from: "2026-08-01", to: "2026-09-30" }));

  assert.equal(f.totals.in, 3200);
  assert.equal(f.totals.out, 142.7);
  assert.equal(f.totals.net, 3057.3);
  assert.deepEqual(f.months.map((m) => m.month), ["2026-08", "2026-09"]);
  assert.equal(f.months[0].out, 91.39);
  assert.equal(f.months[1].out, 51.31);

  const cos = f.categories.find((c) => c.category === "Cost of sales");
  assert.equal(cos?.total, 142.7);
  assert.equal(cos?.count, 3);
});

test("one merchant across many rows is one line", async () => {
  const f = await asTenant(tenant, () => buildFactSheet({ from: "2026-08-01", to: "2026-09-30" }));
  const lidl = f.merchants.find((m) => m.label === "Lidl");
  assert.equal(lidl?.count, 3, "three shops, one merchant");
  assert.equal(lidl?.total, 142.7);
  assert.equal(lidl?.recurring, true, "in both months");
});

test("money moved between your own accounts is reported apart from spending", async () => {
  await reset();
  const csv = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-08-02 09:00:00,2026-08-02 09:00:00,Tesco,-42.15,0.00,EUR,COMPLETED,1957.85
TRANSFER,Current,2026-08-03 09:00:00,2026-08-03 09:00:00,To Savings,-500.00,0.00,EUR,COMPLETED,1457.85
`;
  await asTenant(tenant, () => importTransactions(parseStatementCsv(csv).rows, []));
  const f = await asTenant(tenant, () => buildFactSheet({ from: "2026-08-01", to: "2026-08-31" }));

  assert.equal(f.totals.out, 42.15, "moving €500 to savings is not €500 of spending");
  assert.equal(f.totals.movedBetweenAccounts, 500, "but it is worth saying");
  assert.equal(
    f.merchants.some((m) => /savings/i.test(m.label)),
    false,
    "and savings is not a merchant",
  );
});

test("uncategorised spending is measured, because it is the hole in the breakdown", async () => {
  await reset();
  await tx("Mystery Shop", -80, "2026-08-04");
  await tx("Lidl", -20, "2026-08-05", seeded(tenant, "cat-cogs"));

  const f = await asTenant(tenant, () => buildFactSheet({ from: "2026-08-01", to: "2026-08-31" }));
  assert.equal(f.totals.uncategorisedOut, 80);
  assert.equal(f.totals.uncategorisedCount, 1);
});

test("a category's change is against the period before, or null when there is none", async () => {
  await reset();
  const cat = seeded(tenant, "cat-software");
  await tx("Vercel", -50, "2026-07-10", cat);   // prior period
  await tx("Vercel", -80, "2026-08-10", cat);   // this period
  await tx("Newthing", -10, "2026-08-11", seeded(tenant, "cat-office"));

  const f = await asTenant(tenant, () => buildFactSheet({ from: "2026-08-01", to: "2026-08-31" }));
  const software = f.categories.find((c) => c.category === "Software & subscriptions");
  assert.equal(software?.total, 80);
  assert.equal(software?.change, 30, "spent €30 more than the month before");

  const office = f.categories.find((c) => c.category === "Office & equipment");
  assert.equal(office?.change, null, "nothing to compare against, so no number invented");
});

test("uncategorisedByMerchant returns what a rule could actually be written for", async () => {
  await reset();
  await tx("Easytrip", -10, "2026-08-03");
  await tx("Easytrip", -10, "2026-08-13");
  await tx("Easytrip", -10, "2026-09-03");
  await tx("Lidl", -20, "2026-08-05", seeded(tenant, "cat-cogs"));

  const rows = await asTenant(tenant, () => uncategorisedByMerchant());
  assert.equal(rows.length, 1, "the categorised one is not proposed again");
  assert.equal(rows[0].label, "Easytrip");
  assert.equal(rows[0].count, 3);
  assert.equal(rows[0].total, 30);
  assert.equal(rows[0].recurring, true);
});

test("an empty period produces an empty sheet rather than throwing", async () => {
  await reset();
  const f = await asTenant(tenant, () => buildFactSheet({ from: "2020-01-01", to: "2020-12-31" }));
  assert.deepEqual(f.months, []);
  assert.equal(f.totals.net, 0);
  assert.equal(f.merchants.length, 0);
});

test("with no credentials the features decline rather than throw", async () => {
  const saved = { key: process.env.AI_GATEWAY_API_KEY, oidc: process.env.VERCEL_OIDC_TOKEN };
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.VERCEL_OIDC_TOKEN;
  try {
    const { aiIsConfigured } = await import("../src/lib/ai");
    assert.equal(aiIsConfigured(), false);

    // Both entry points must degrade, because a set of books that stops working
    // when a model is unreachable is a bad trade for some commentary.
    const { generateReport } = await import("../src/lib/ai-report");
    const { proposeRules } = await import("../src/lib/ai-rules");
    const r1 = await asTenant(tenant, () => generateReport({ from: "2026-08-01", to: "2026-08-31" }));
    const r2 = await asTenant(tenant, () => proposeRules());
    assert.equal(r1.ok, false);
    assert.equal(r2.ok, false);
    if (!r1.ok) assert.match(r1.reason, /credentials/i);
  } finally {
    if (saved.key) process.env.AI_GATEWAY_API_KEY = saved.key;
    if (saved.oidc) process.env.VERCEL_OIDC_TOKEN = saved.oidc;
  }
});

test("a gateway failure is turned into something a page can say", async () => {
  const { describeFailure } = await import("../src/lib/ai");
  const { APICallError } = await import("ai");
  const make = (statusCode: number) =>
    new APICallError({ message: "x", url: "u", requestBodyValues: {}, statusCode });

  assert.match(describeFailure(make(402)).reason, /budget/i);
  assert.match(describeFailure(make(429)).reason, /too many/i);
  assert.match(describeFailure(make(503)).reason, /unavailable/i);
  assert.equal(describeFailure(new Error("boom")).reason, "boom");
});
