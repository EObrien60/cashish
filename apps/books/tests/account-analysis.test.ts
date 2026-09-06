/**
 * One account, looked at closely.
 *
 * The number this file exists to protect is "actual return": growth with the
 * money you carried in and out taken away. On a savings account that is the
 * difference between "I earned €19" and "I earned €22,564", and only one of
 * them is true.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import { asTenant, makeTenant, closePool } from "./harness";
import { db, schema } from "@cashish/core/db";
import { parseStatementCsv } from "../src/lib/import";
import { importTransactions } from "../src/lib/transactions";
import { listAccounts, accountBalances } from "../src/lib/accounts";
import { analyseAccount } from "../src/lib/account-analysis";

let tenant: string;

before(async () => {
  tenant = (await makeTenant("analysis")).id;
});
after(closePool);

const reset = () =>
  asTenant(tenant, async () => {
    await db.delete(schema.transactions).where(eq(schema.transactions.tenantId, tenant));
    await db.delete(schema.accounts).where(eq(schema.accounts.tenantId, tenant));
  });

test("growth is split into what you moved in and what the account did", async () => {
  await reset();

  // €1,000 moved from the current account into savings, which then earns €12.
  const current = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
TRANSFER,Current,2026-01-05 09:00:00,2026-01-05 09:00:00,To Savings,-1000.00,0.00,EUR,COMPLETED,4000.00
`;
  await asTenant(tenant, () => importTransactions(parseStatementCsv(current).rows, []));

  const savings = `Date,Description,"Value, EUR"
"5 Jan 2026, 09:00:00",BUY EUR Class R,"1,000.00"
"31 Jan 2026, 01:00:00",Return PAID EUR Class R,5.00
"28 Feb 2026, 01:00:00",Return PAID EUR Class R,7.00
"28 Feb 2026, 01:00:00",Service Fee Charged,-0.50
`;
  await asTenant(tenant, () =>
    importTransactions(parseStatementCsv(savings).rows, [], { fallbackAccount: "Savings" }),
  );

  const account = (await asTenant(tenant, () => listAccounts())).find((a) => a.name === "Savings")!;
  const analysis = await asTenant(tenant, () => analyseAccount(account.id));

  assert.equal(analysis.transferredIn, 1000, "the deposit is money moved, not money earned");
  assert.equal(analysis.earned, 12, "€5 + €7 of return");
  assert.equal(analysis.spent, 0.5, "and a fee");
  assert.equal(analysis.growth, 1011.5, "the balance did grow by all of it");
  assert.equal(
    analysis.growthFromAccount,
    11.5,
    "but the account itself only produced €11.50",
  );
});

test("the monthly series is continuous and ends at the account balance", async () => {
  const account = (await asTenant(tenant, () => listAccounts())).find((a) => a.name === "Savings")!;
  const analysis = await asTenant(tenant, () => analyseAccount(account.id));
  const balances = await asTenant(tenant, () => accountBalances());
  const balance = balances.find((b) => b.id === account.id)!;

  assert.deepEqual(
    analysis.months.map((m) => m.month),
    ["2026-01", "2026-02"],
  );
  assert.equal(analysis.months[0].closing, 1005);
  assert.equal(
    analysis.months.at(-1)!.closing,
    balance.balance,
    "the chart has to end where the accounts page says it does",
  );
});

test("a month with no activity is a flat line, not a missing point", async () => {
  await reset();
  await asTenant(tenant, () =>
    importTransactions(
      parseStatementCsv(`Date,Description,"Value, EUR"
"5 Jan 2026, 09:00:00",Opening,100.00
"5 Apr 2026, 09:00:00",More,50.00
`).rows,
      [],
      { fallbackAccount: "Savings" },
    ),
  );

  const account = (await asTenant(tenant, () => listAccounts()))[0];
  const analysis = await asTenant(tenant, () => analyseAccount(account.id));

  assert.deepEqual(
    analysis.months.map((m) => m.month),
    ["2026-01", "2026-02", "2026-03", "2026-04"],
  );
  assert.equal(analysis.months[1].closing, 100, "February held its balance");
  assert.equal(analysis.months[1].in, 0);
  assert.equal(analysis.months.at(-1)!.closing, 150);
});

test("an opening balance starts the line where the account really started", async () => {
  const account = (await asTenant(tenant, () => listAccounts()))[0];
  const analysis = await asTenant(tenant, () =>
    analyseAccount(account.id, { openingBalance: 500 }),
  );
  assert.equal(analysis.months[0].closing, 600);
  assert.equal(analysis.growth, 150, "growth is still what happened, not the opening balance");
});

test("repeated lines are folded together rather than listed 800 times", async () => {
  await reset();
  const rows = Array.from({ length: 40 }, (_, i) => {
    const day = String((i % 28) + 1).padStart(2, "0");
    return `"${day} Jan 2026, 01:00:00",Return PAID EUR Class R IE000AZVL3K0,1.00`;
  }).join("\n");
  await asTenant(tenant, () =>
    importTransactions(parseStatementCsv(`Date,Description,"Value, EUR"\n${rows}\n`).rows, [], {
      fallbackAccount: "Savings",
    }),
  );

  const account = (await asTenant(tenant, () => listAccounts()))[0];
  const analysis = await asTenant(tenant, () => analyseAccount(account.id));
  const top = analysis.topLines[0];
  assert.equal(top.label, "Return PAID EUR");
  assert.equal(top.count, 40);
  assert.equal(top.total, 40);
  assert.ok(analysis.topLines.length <= 8, "a summary, not the ledger again");
});

test("an account with nothing on it does not throw", async () => {
  await reset();
  const { ensureAccount } = await import("../src/lib/accounts");
  const { id } = await asTenant(tenant, () => ensureAccount({ name: "Brand new" }));
  const analysis = await asTenant(tenant, () => analyseAccount(id));
  assert.deepEqual(analysis.months, []);
  assert.equal(analysis.growth, 0);
  assert.equal(analysis.first, null);
});

test("a return is not claimed when a deposit could be hiding in it", async () => {
  await reset();
  // The realistic case: only the savings statement is imported, so the €20,000
  // deposit has no transfer to match and looks exactly like interest.
  const csv = `Date,Description,"Value, EUR"
"5 Jan 2026, 09:00:00",BUY EUR Class R,"20,000.00"
"31 Jan 2026, 01:00:00",Return PAID EUR Class R,12.00
`;
  await asTenant(tenant, () =>
    importTransactions(parseStatementCsv(csv).rows, [], { fallbackAccount: "Savings" }),
  );

  const account = (await asTenant(tenant, () => listAccounts()))[0];
  const analysis = await asTenant(tenant, () => analyseAccount(account.id));

  assert.equal(analysis.growthFromAccount, 20012, "arithmetically that is the growth");
  assert.equal(
    analysis.returnIsKnowable,
    false,
    "but calling €20,012 a return would be a lie, and the page must not",
  );
  assert.equal(analysis.unmatchedIn, 20012);
});

test("once the other side is imported, the return becomes knowable", async () => {
  await reset();
  const current = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
TRANSFER,Current,2026-01-05 09:00:00,2026-01-05 09:00:00,To Savings,-20000.00,0.00,EUR,COMPLETED,1000.00
`;
  await asTenant(tenant, () => importTransactions(parseStatementCsv(current).rows, []));
  const savings = `Date,Description,"Value, EUR"
"5 Jan 2026, 09:00:00",BUY EUR Class R,"20,000.00"
"31 Jan 2026, 01:00:00",Return PAID EUR Class R,12.00
`;
  await asTenant(tenant, () =>
    importTransactions(parseStatementCsv(savings).rows, [], { fallbackAccount: "Savings" }),
  );

  const account = (await asTenant(tenant, () => listAccounts())).find((a) => a.name === "Savings")!;
  const analysis = await asTenant(tenant, () => analyseAccount(account.id));

  assert.equal(analysis.transferredIn, 20000, "the deposit is now recognised as moved money");
  assert.equal(analysis.returnIsKnowable, true);
  assert.equal(analysis.growthFromAccount, 12, "and the return is the €12 it always was");
});
