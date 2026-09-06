/**
 * Multiple accounts, and the transfers between them.
 *
 * The failure this file exists to prevent: paying a credit card off the current
 * account is one movement on two statements, and counted naively it is spending
 * you did not do plus income you did not receive. Both halves of that are
 * asserted, along with the conservative half of the detector — "To Sarah Jane
 * Hughes" is payroll, not a transfer, and must stay in the books.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import { asTenant, makeTenant, closePool } from "./harness";
import { db, schema } from "@cashish/core/db";
import { parseStatementCsv } from "../src/lib/import";
import { importTransactions, listTransactions } from "../src/lib/transactions";
import {
  accountBalances,
  ensureAccount,
  kindFromStatement,
  listAccounts,
  nameFromStatement,
  unassignedCount,
  assignUnassigned,
  groupAccounts,
  mergeAccounts,
} from "../src/lib/accounts";
import { detectTransfers, pairTransfers, unmarkTransfer } from "../src/lib/transfers";
import { profitAndLoss } from "../src/lib/reports";
import { uid } from "../src/lib/id";

let tenant: string;

before(async () => {
  tenant = (await makeTenant("accounts")).id;
});
after(closePool);

const reset = () =>
  asTenant(tenant, async () => {
    await db.delete(schema.transactions).where(eq(schema.transactions.tenantId, tenant));
    await db.delete(schema.accounts).where(eq(schema.accounts.tenantId, tenant));
  });

test("Revolut's own words map to account kinds", () => {
  assert.equal(kindFromStatement("Current"), "current");
  assert.equal(kindFromStatement("Savings"), "savings");
  assert.equal(kindFromStatement("Deposit"), "savings");
  assert.equal(kindFromStatement("Credit"), "credit_card");
  assert.equal(kindFromStatement("Pocket"), "pocket");
  assert.equal(kindFromStatement("EUR"), "current", "an unremarkable account is a current one");
});

test("a bare currency code is named readably", () => {
  assert.equal(nameFromStatement("EUR", "Main"), "EUR account");
  assert.equal(nameFromStatement("Main · EUR", "Main"), "Main · EUR");
  assert.equal(nameFromStatement("", "Main"), "Main");
});

test("a personal export's Product column becomes the accounts", async () => {
  await reset();
  const csv = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-08-02 09:00:00,2026-08-02 09:00:00,Tesco,-42.15,0.00,EUR,COMPLETED,1957.85
CARD_PAYMENT,Credit,2026-08-03 09:00:00,2026-08-03 09:00:00,Argos,-99.00,0.00,EUR,COMPLETED,-99.00
TRANSFER,Savings,2026-08-04 09:00:00,2026-08-04 09:00:00,Interest,1.20,0.00,EUR,COMPLETED,501.20
`;
  const parsed = parseStatementCsv(csv);
  const summary = await asTenant(tenant, () => importTransactions(parsed.rows, parsed.errors));

  assert.equal(summary.inserted, 3);
  const names = (summary.accounts ?? []).map((a) => a.name).sort();
  assert.deepEqual(names, ["Credit", "Current", "Savings"]);

  const accounts = await asTenant(tenant, () => listAccounts());
  assert.equal(accounts.length, 3);
  assert.equal(accounts.find((a) => a.name === "Credit")?.kind, "credit_card");
  assert.equal(accounts.find((a) => a.name === "Savings")?.kind, "savings");
  assert.ok(accounts.every((a) => !a.inferred), "an account seen in a statement is not inferred");
});

test("every imported row lands on an account", async () => {
  const rows = await asTenant(tenant, () => listTransactions({ excluded: "all" }));
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.accountId), "a transaction on no account can never be reconciled");
});

test("re-importing the same statement does not create the accounts twice", async () => {
  const csv = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-08-02 09:00:00,2026-08-02 09:00:00,Tesco,-42.15,0.00,EUR,COMPLETED,1957.85
`;
  const parsed = parseStatementCsv(csv);
  const summary = await asTenant(tenant, () => importTransactions(parsed.rows, parsed.errors));
  assert.equal(summary.inserted, 0, "the row is already on file");
  const accounts = await asTenant(tenant, () => listAccounts());
  assert.equal(accounts.length, 3);
});

test("an internal move names both ends, and the far account is created to hold it", async () => {
  await reset();
  const csv = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
EXCHANGE,Main · EUR,2025-07-11 09:00:00,2025-07-11 09:00:00,Main · EUR → Main · GBP,-392.43,0.00,EUR,COMPLETED,4000.00
`;
  const parsed = parseStatementCsv(csv);
  const summary = await asTenant(tenant, () => importTransactions(parsed.rows, parsed.errors));

  assert.equal(summary.transfers?.detected, 1);
  assert.deepEqual(summary.transfers?.accountsCreated, ["Main · GBP"]);

  const accounts = await asTenant(tenant, () => listAccounts());
  const gbp = accounts.find((a) => a.name === "Main · GBP");
  assert.ok(gbp, "the other side of the transfer has to exist for the money to have gone there");
  assert.equal(gbp.inferred, true, "and it is flagged, because it was never in a statement");

  const [row] = await asTenant(tenant, () => listTransactions({ excluded: "only" }));
  assert.ok(row, "a transfer is out of the books");
  assert.equal(row.transferAccountId, gbp.id);
  assert.match(row.excludedReason ?? "", /Transfer to Main · GBP/);
});

test("a transfer is not spending", async () => {
  const pnl = await asTenant(tenant, () => profitAndLoss("2025-01-01", "2025-12-31"));
  assert.equal(pnl.totalExpense, 0, "moving your own money is not an expense");
  assert.equal(pnl.uncategorizedExpense, 0);
});

test("paying somebody is not a transfer, however much it looks like one", async () => {
  await reset();
  const csv = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
TRANSFER,Current,2026-08-05 09:00:00,2026-08-05 09:00:00,To Sarah Jane Hughes,-1500.00,0.00,EUR,COMPLETED,2500.00
TRANSFER,Current,2026-08-06 09:00:00,2026-08-06 09:00:00,To Quantum Harbour IT Systems Limited,-6150.00,0.00,EUR,COMPLETED,-3650.00
`;
  const parsed = parseStatementCsv(csv);
  const summary = await asTenant(tenant, () => importTransactions(parsed.rows, parsed.errors));

  assert.equal(summary.transfers?.detected, 0, "wages and suppliers stay in the books");
  const excluded = await asTenant(tenant, () => listTransactions({ excluded: "only" }));
  assert.equal(excluded.length, 0);
});

test("'To X' is a transfer when X is an account you named yourself", async () => {
  await reset();
  // Not a Revolut product word — this can only be recognised because the
  // account exists, which is the second of the three rules.
  await asTenant(tenant, () => ensureAccount({ name: "House deposit", kind: "savings" }));

  const csv = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
TRANSFER,Current,2026-08-07 09:00:00,2026-08-07 09:00:00,To House deposit,-200.00,0.00,EUR,COMPLETED,2300.00
TRANSFER,Current,2026-08-08 09:00:00,2026-08-08 09:00:00,To Ronan Kenny,-300.00,0.00,EUR,COMPLETED,2000.00
`;
  const parsed = parseStatementCsv(csv);
  const summary = await asTenant(tenant, () => importTransactions(parsed.rows, parsed.errors));

  assert.equal(summary.transfers?.detected, 1);
  const excluded = await asTenant(tenant, () => listTransactions({ excluded: "only" }));
  assert.equal(excluded.length, 1);
  assert.equal(excluded[0].description, "To House deposit");
});

test("Revolut's product words are trusted before the account exists", async () => {
  await reset();
  // Nothing but the Current account exists. "To Savings" still has to be
  // recognised, because people export one account at a time and the savings
  // statement may never be imported at all.
  const csv = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
TRANSFER,Current,2026-08-07 09:00:00,2026-08-07 09:00:00,To Savings,-200.00,0.00,EUR,COMPLETED,2300.00
TRANSFER,Current,2026-08-09 09:00:00,2026-08-09 09:00:00,To GBP,-50.00,0.00,EUR,COMPLETED,2250.00
TRANSFER,Current,2026-08-08 09:00:00,2026-08-08 09:00:00,To Ronan Kenny,-300.00,0.00,EUR,COMPLETED,2000.00
`;
  const parsed = parseStatementCsv(csv);
  const summary = await asTenant(tenant, () => importTransactions(parsed.rows, parsed.errors));

  assert.equal(summary.transfers?.detected, 2, "Savings and GBP, not Ronan Kenny");
  assert.deepEqual((summary.transfers?.accountsCreated ?? []).sort(), ["GBP", "Savings"]);

  const accounts = await asTenant(tenant, () => listAccounts());
  assert.ok(accounts.find((a) => a.name === "Savings")?.inferred);
  assert.ok(accounts.find((a) => a.name === "GBP")?.inferred);
});

test("both halves are linked once the second statement arrives", async () => {
  await reset();

  const current = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
TRANSFER,Current,2026-08-10 09:00:00,2026-08-10 09:00:00,To Credit,-450.00,0.00,EUR,COMPLETED,1550.00
`;
  const card = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
TRANSFER,Credit,2026-08-11 09:00:00,2026-08-11 09:00:00,From Current,450.00,0.00,EUR,COMPLETED,0.00
`;

  // The card account does not exist yet: the first import has to infer it.
  const first = await asTenant(tenant, () =>
    importTransactions(parseStatementCsv(current).rows, []),
  );
  assert.equal(first.transfers?.detected, 1);
  assert.deepEqual(first.transfers?.accountsCreated, ["Credit"]);

  const second = await asTenant(tenant, () => importTransactions(parseStatementCsv(card).rows, []));
  assert.equal(second.transfers?.paired, 1, "the two halves are the same movement");

  const rows = await asTenant(tenant, () => listTransactions({ excluded: "all" }));
  const out = rows.find((r) => r.amount === -450);
  const inn = rows.find((r) => r.amount === 450);
  assert.equal(out?.transferPeerId, inn?.id);
  assert.equal(inn?.transferPeerId, out?.id);

  // And an account met as a guess becomes real when its own statement lands.
  const credit = (await asTenant(tenant, () => listAccounts())).find((a) => a.name === "Credit");
  assert.equal(credit?.inferred, false);
});

test("neither half is counted as income or expenditure", async () => {
  const pnl = await asTenant(tenant, () => profitAndLoss("2026-01-01", "2026-12-31"));
  assert.equal(pnl.totalIncome, 0, "money arriving from your own account is not income");
  assert.equal(pnl.totalExpense, 0);
});

test("balances are what the bank says, transfers included", async () => {
  const balances = await asTenant(tenant, () => accountBalances());
  const current = balances.find((b) => b.name === "Current");
  const credit = balances.find((b) => b.name === "Credit");

  assert.equal(current?.balance, -450, "the money did leave the current account");
  assert.equal(credit?.balance, 450, "and it did arrive on the card");
  assert.equal(current?.transactions, 1);
});

test("a detection can be undone", async () => {
  const [row] = await asTenant(tenant, () => listTransactions({ excluded: "only" }));
  assert.ok(row);
  await asTenant(tenant, () => unmarkTransfer(row.id));

  const after = await asTenant(tenant, () => listTransactions({ excluded: "all" }));
  const back = after.find((r) => r.id === row.id);
  assert.equal(back?.excluded, false);
  assert.equal(back?.transferAccountId, null);
});

test("rows imported before accounts existed can be assigned in one go", async () => {
  await reset();
  await asTenant(tenant, async () => {
    await db.insert(schema.transactions).values({
      id: uid(),
      tenantId: tenant,
      bookedDate: "2025-01-05",
      amount: -20,
      description: "Old row, no account",
      importBatch: "legacy",
    });
  });

  assert.equal(await asTenant(tenant, () => unassignedCount()), 1);
  const { id } = await asTenant(tenant, () => ensureAccount({ name: "Main" }));
  assert.equal(await asTenant(tenant, () => assignUnassigned(id)), 1);
  assert.equal(await asTenant(tenant, () => unassignedCount()), 0);
});

test("detection over the whole ledger is safe to re-run", async () => {
  const before = await asTenant(tenant, () => detectTransfers());
  const again = await asTenant(tenant, () => detectTransfers());
  assert.equal(again.detected, 0, "a second pass must not re-classify what it already did");
  assert.equal(before.detected >= 0, true);
  const pairedTwice = await asTenant(tenant, () => pairTransfers());
  assert.equal(pairedTwice, 0);
});

test("money sent to an account with no statement still shows up there", async () => {
  await reset();
  const csv = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
TRANSFER,Current,2026-08-03 09:00:00,2026-08-03 09:00:00,To Savings,-500.00,0.00,EUR,COMPLETED,2500.00
`;
  await asTenant(tenant, () => importTransactions(parseStatementCsv(csv).rows, []));

  const balances = await asTenant(tenant, () => accountBalances());
  const current = balances.find((b) => b.name === "Current");
  const savings = balances.find((b) => b.name === "Savings");

  assert.equal(current?.balance, -500, "it left the current account");
  assert.equal(savings?.balance, 500, "so it has to be in savings, or the books do not balance");
  assert.equal(savings?.derivedFromTransfers, 500);
  assert.equal(savings?.transactions, 0, "and savings has no statement of its own yet");

  // The two sides cancel: nothing was created or destroyed by moving it.
  const net = balances.reduce((acc, b) => acc + b.balance, 0);
  assert.equal(net, 0);
});

test("a currency exchange is not guessed at", async () => {
  await reset();
  const csv = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
EXCHANGE,Current,2026-08-12 09:00:00,2026-08-12 09:00:00,Main · EUR → Main · GBP,-150.00,0.00,EUR,COMPLETED,2000.00
`;
  await asTenant(tenant, () => importTransactions(parseStatementCsv(csv).rows, []));

  const gbp = (await asTenant(tenant, () => accountBalances())).find((b) => b.name === "Main · GBP");
  assert.equal(gbp?.currency, "GBP", "the name says which currency it is");
  assert.equal(gbp?.balance, 0, "€150 is not £150, and the statement does not say what arrived");
  assert.equal(gbp?.unknownIncoming, 150, "but it is known that something did");
});

test("once both sides exist the transfer is not counted twice", async () => {
  await reset();
  const out = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
TRANSFER,Current,2026-08-05 09:00:00,2026-08-05 09:00:00,To Credit,-260.00,0.00,EUR,COMPLETED,2000.00
`;
  const back = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
TRANSFER,Credit,2026-08-05 09:00:00,2026-08-05 09:00:00,From Current,260.00,0.00,EUR,COMPLETED,0.00
`;
  await asTenant(tenant, () => importTransactions(parseStatementCsv(out).rows, []));
  await asTenant(tenant, () => importTransactions(parseStatementCsv(back).rows, []));

  const credit = (await asTenant(tenant, () => accountBalances())).find((b) => b.name === "Credit");
  assert.equal(credit?.balance, 260, "the card's own row, counted once");
  assert.equal(credit?.derivedFromTransfers, 0, "the inferred half stops applying once it is real");
});

test("a book that predates accounts can be set up from its own transactions", async () => {
  await reset();

  // The shape of a real existing book: rows imported before accounts existed,
  // including one internal move and one payment to a person.
  await asTenant(tenant, async () => {
    await db.insert(schema.transactions).values([
      {
        id: uid(),
        tenantId: tenant,
        bookedDate: "2025-07-11",
        amount: -392.43,
        description: "Main · EUR → Main · GBP",
        importBatch: "legacy",
      },
      {
        id: uid(),
        tenantId: tenant,
        bookedDate: "2025-08-09",
        amount: -5456.12,
        description: "To Quantum Harbour IT Systems Limited",
        importBatch: "legacy",
      },
      {
        id: uid(),
        tenantId: tenant,
        bookedDate: "2025-08-20",
        amount: -200,
        description: "To Savings",
        importBatch: "legacy",
      },
    ]);
  });

  assert.equal(await asTenant(tenant, () => unassignedCount()), 3);

  // What the button does: name the account, assign, then scan.
  const { id } = await asTenant(tenant, () => ensureAccount({ name: "Main" }));
  const assigned = await asTenant(tenant, () => assignUnassigned(id));
  const found = await asTenant(tenant, () => detectTransfers());
  await asTenant(tenant, () => pairTransfers());

  assert.equal(assigned, 3);
  assert.equal(await asTenant(tenant, () => unassignedCount()), 0);
  assert.equal(found.detected, 2, "the exchange and the savings move, not the supplier payment");
  assert.deepEqual(found.accountsCreated.sort(), ["Main · GBP", "Savings"]);

  const balances = await asTenant(tenant, () => accountBalances());
  assert.equal(balances.find((b) => b.name === "Savings")?.balance, 200);
  assert.equal(
    balances.find((b) => b.name === "Main · GBP")?.unknownIncoming,
    392.43,
    "a euro-to-sterling move is known but not counted",
  );

  // The supplier payment is untouched and still an expense.
  const inBooks = await asTenant(tenant, () => listTransactions({}));
  assert.equal(inBooks.length, 1);
  assert.match(inBooks[0].description ?? "", /Quantum Harbour/);
});

test("running the scan twice changes nothing the second time", async () => {
  const again = await asTenant(tenant, () => detectTransfers());
  assert.equal(again.detected, 0);
  assert.equal(again.accountsCreated.length, 0);
});

test("a savings statement parses: its own date format, its own amount column", () => {
  // Revolut's savings export: a "Value, EUR" column instead of Amount, dates
  // written "2 Sept 2026, 11:37:44", thousands separators, and nothing at all
  // naming the account.
  const csv = `Date,Description,"Value, EUR",Price per share,Quantity of shares
"2 Sept 2026, 11:37:44",BUY EUR Class R IE000AZVL3K0,"20,560.92",,
"6 Sept 2026, 01:42:43",Return PAID EUR Class R IE000AZVL3K0,1.4929,,
"22 Jun 2026, 11:20:27",SELL EUR Class R IE000AZVL3K0,"-1,050",,
`;
  const parsed = parseStatementCsv(csv);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.rows[0].bookedDate, "2026-09-02", "'Sept' is four letters and still a date");
  assert.equal(parsed.rows[0].amount, 20560.92, "thousands separators are not decimal points");
  assert.equal(parsed.rows[2].amount, -1050);
  assert.equal(parsed.rows[1].currency, "EUR", "the currency is in the column header");
});

test("a date that cannot be read is reported, not silently made up", () => {
  const csv = `Date,Description,"Value, EUR"
"the day before yesterday",Interest,1.00
`;
  const parsed = parseStatementCsv(csv);
  assert.equal(parsed.rows.length, 0);
  assert.match(parsed.errors[0] ?? "", /could not read the date/);
});

test("a statement with no account column lands where it is told", async () => {
  await reset();
  const csv = `Date,Description,"Value, EUR"
"2 Sept 2026, 11:37:44",BUY EUR Class R,"1,000.00"
"6 Sept 2026, 01:42:43",Return PAID EUR Class R,1.49
`;
  const parsed = parseStatementCsv(csv);
  const summary = await asTenant(tenant, () =>
    importTransactions(parsed.rows, parsed.errors, { fallbackAccount: "Flexible savings" }),
  );

  assert.equal(summary.inserted, 2);
  assert.deepEqual(
    (summary.accounts ?? []).map((a) => a.name),
    ["Flexible savings"],
  );

  const balances = await asTenant(tenant, () => accountBalances());
  assert.equal(balances.find((b) => b.name === "Flexible savings")?.balance, 1001.49);
});

test("held, owed and net are three different questions", async () => {
  await reset();
  await asTenant(tenant, async () => {
    const current = await ensureAccount({ name: "Current", kind: "current" });
    const savings = await ensureAccount({ name: "Savings", kind: "savings" });
    const card = await ensureAccount({ name: "Credit", kind: "credit_card" });
    await db.insert(schema.transactions).values([
      { id: uid(), tenantId: tenant, bookedDate: "2026-08-01", amount: 2000, description: "Salary", accountId: current.id, importBatch: "t" },
      { id: uid(), tenantId: tenant, bookedDate: "2026-08-02", amount: 500, description: "Interest", accountId: savings.id, importBatch: "t" },
      { id: uid(), tenantId: tenant, bookedDate: "2026-08-03", amount: -300, description: "Argos", accountId: card.id, importBatch: "t" },
    ]);
  });

  const [group] = groupAccounts(await asTenant(tenant, () => accountBalances()));
  assert.equal(group.held, 2500, "a card balance is not money you hold");
  assert.equal(group.owed, 300, "it is money you owe, stated positively");
  assert.equal(group.net, 2200);
  assert.equal(group.saved, 500, "and some of what you hold is set aside");
  assert.equal(group.assets.length, 2);
  assert.equal(group.liabilities.length, 1);
});

test("currencies are grouped, never added together", async () => {
  await asTenant(tenant, async () => {
    const gbp = await ensureAccount({ name: "Main · GBP", kind: "current" });
    await db.insert(schema.transactions).values({
      id: uid(), tenantId: tenant, bookedDate: "2026-08-04", amount: 100,
      description: "Sterling in", accountId: gbp.id, currency: "GBP", importBatch: "t",
    });
  });

  const groups = groupAccounts(await asTenant(tenant, () => accountBalances()));
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.currency).sort(), ["EUR", "GBP"]);
  assert.equal(groups.find((g) => g.currency === "GBP")?.held, 100);
  assert.equal(groups.find((g) => g.currency === "EUR")?.held, 2500);
});

test("two accounts that are the same account can be folded into one", async () => {
  await reset();

  // Exactly the mistake: a transfer says "To Savings" so Savings is created,
  // then the statement is imported under the name Revolut gives it.
  const current = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
TRANSFER,Current,2026-09-02 11:37:44,2026-09-02 11:37:44,To Savings,-1000.00,0.00,EUR,COMPLETED,4000.00
`;
  await asTenant(tenant, () => importTransactions(parseStatementCsv(current).rows, []));

  const savings = `Date,Description,"Value, EUR"
"2 Sept 2026, 11:37:44",BUY EUR Class R,"1,000.00"
"6 Sept 2026, 01:42:43",Return PAID EUR Class R,2.50
`;
  await asTenant(tenant, () =>
    importTransactions(parseStatementCsv(savings).rows, [], { fallbackAccount: "Flexible savings" }),
  );

  const before = groupAccounts(await asTenant(tenant, () => accountBalances()))[0];
  assert.equal(before.saved, 2002.5, "the same €1,000 is counted twice, in two accounts");

  const all = await asTenant(tenant, () => listAccounts());
  const inferred = all.find((a) => a.name === "Savings")!;
  const real = all.find((a) => a.name === "Flexible savings")!;
  // What mergeAccountsAction does: fold, then try pairing again, because the
  // far side of that transfer is now reachable.
  const result = await asTenant(tenant, () => mergeAccounts(inferred.id, real.id));
  await asTenant(tenant, () => pairTransfers());

  assert.equal(result.moved, 0, "the inferred account had no transactions of its own");
  assert.equal(result.repointed, 1, "but a transfer pointed at it");

  const after = groupAccounts(await asTenant(tenant, () => accountBalances()))[0];
  assert.equal(after.saved, 1002.5, "counted once: the €1,000 that moved, plus €2.50 interest");
  assert.equal(
    (await asTenant(tenant, () => listAccounts())).length,
    2,
    "and the duplicate is gone, not left behind empty",
  );
});

test("merging keeps the transfer pointing somewhere real", async () => {
  const rows = await asTenant(tenant, () => listTransactions({ excluded: "only" }));
  const transfer = rows.find((r) => r.description === "To Savings");
  assert.ok(transfer);
  const accounts = await asTenant(tenant, () => listAccounts());
  const target = accounts.find((a) => a.id === transfer.transferAccountId);
  assert.equal(target?.name, "Flexible savings");
});

test("two identical transactions on one day are both kept, and a re-import adds neither", async () => {
  await reset();
  // No ID column and no balance column: nothing distinguishes these two rows,
  // and dropping one would quietly lose €3.50 from the ledger.
  const csv = `Date,Description,"Value, EUR"
"2 Sept 2026, 09:00:00",Insomnia Coffee,-3.50
"2 Sept 2026, 09:00:00",Insomnia Coffee,-3.50
`;
  const first = await asTenant(tenant, () =>
    importTransactions(parseStatementCsv(csv).rows, [], { fallbackAccount: "Current" }),
  );
  assert.equal(first.inserted, 2, "two coffees is two transactions");

  const again = await asTenant(tenant, () =>
    importTransactions(parseStatementCsv(csv).rows, [], { fallbackAccount: "Current" }),
  );
  assert.equal(again.inserted, 0, "and the same file twice is still idempotent");

  const balances = await asTenant(tenant, () => accountBalances());
  assert.equal(balances.find((b) => b.name === "Current")?.balance, -7);
});

test("the bank's decoration of an account name does not hide a transfer", async () => {
  await reset();
  // Real case: the account is called "Saving"; the statement writes
  // "To EUR Saving". Exact matching missed every one of these — €29,388 worth
  // on one book, all of it counted as spending.
  const { ensureAccount } = await import("../src/lib/accounts");
  await asTenant(tenant, () => ensureAccount({ name: "Saving", kind: "savings" }));

  const csv = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
TRANSFER,Main,2026-08-03 09:00:00,2026-08-03 09:00:00,To EUR Saving,-2000.00,0.00,EUR,COMPLETED,1000.00
`;
  const summary = await asTenant(tenant, () =>
    importTransactions(parseStatementCsv(csv).rows, []),
  );
  assert.equal(summary.transfers?.detected, 1, "moving to your own savings is not spending");

  const [row] = await asTenant(tenant, () => listTransactions({ excluded: "only" }));
  assert.match(row.excludedReason ?? "", /Transfer to Saving/);
});

test("a 'Transfer to' prefix is read the same as a bare 'To'", async () => {
  await reset();
  const { ensureAccount } = await import("../src/lib/accounts");
  await asTenant(tenant, () => ensureAccount({ name: "Savings", kind: "savings" }));

  const csv = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
TRANSFER,Main,2026-08-03 09:00:00,2026-08-03 09:00:00,Transfer to Savings,-300.00,0.00,EUR,COMPLETED,700.00
TRANSFER,Main,2026-08-04 09:00:00,2026-08-04 09:00:00,Payment to Credit,-100.00,0.00,EUR,COMPLETED,600.00
`;
  const summary = await asTenant(tenant, () => importTransactions(parseStatementCsv(csv).rows, []));
  assert.equal(summary.transfers?.detected, 2);
});

test("a short account name cannot claim every merchant that contains it", async () => {
  await reset();
  const { ensureAccount } = await import("../src/lib/accounts");
  // "EUR" is three characters. Containment matching must not let it swallow
  // unrelated descriptions, because a false transfer deletes real spending.
  await asTenant(tenant, () => ensureAccount({ name: "EUR", kind: "current" }));

  const csv = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Main,2026-08-05 09:00:00,2026-08-05 09:00:00,To EURO GARDEN CENTRE,-60.00,0.00,EUR,COMPLETED,940.00
`;
  const summary = await asTenant(tenant, () => importTransactions(parseStatementCsv(csv).rows, []));
  assert.equal(summary.transfers?.detected, 0, "a garden centre is not your EUR account");
  const inBooks = await asTenant(tenant, () => listTransactions({}));
  assert.equal(inBooks.length, 1, "and it stays in the books");
});

test("paying a person is still not a transfer, however it is worded", async () => {
  await reset();
  const csv = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
TRANSFER,Main,2026-08-06 09:00:00,2026-08-06 09:00:00,Transfer to ETHAN,-1500.00,0.00,EUR,COMPLETED,500.00
TRANSFER,Main,2026-08-07 09:00:00,2026-08-07 09:00:00,To Sarah Jane Hughes,-1500.00,0.00,EUR,COMPLETED,-1000.00
`;
  const summary = await asTenant(tenant, () => importTransactions(parseStatementCsv(csv).rows, []));
  assert.equal(
    summary.transfers?.detected,
    0,
    "a move to your own account called Ethan and a payment to a person called Ethan are indistinguishable, so neither is assumed",
  );
});

test("marking a transfer by hand takes both it and its match out of spending", async () => {
  await reset();
  const { ensureAccount } = await import("../src/lib/accounts");
  const { markTransfer } = await import("../src/lib/transfers");
  const savings = await asTenant(tenant, () => ensureAccount({ name: "Rainy day", kind: "savings" }));

  const csv = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
TRANSFER,Main,2026-08-06 09:00:00,2026-08-06 09:00:00,Transfer to ETHAN,-1500.00,0.00,EUR,COMPLETED,500.00
`;
  await asTenant(tenant, () => importTransactions(parseStatementCsv(csv).rows, []));
  const [row] = await asTenant(tenant, () => listTransactions({}));
  assert.ok(row, "it is in the books until someone says otherwise");

  await asTenant(tenant, () => markTransfer(row.id, savings.id));

  const stillCounted = await asTenant(tenant, () => listTransactions({}));
  assert.equal(stillCounted.length, 0, "once said, it is not spending");
  const [excluded] = await asTenant(tenant, () => listTransactions({ excluded: "only" }));
  assert.match(excluded.excludedReason ?? "", /Transfer to Rainy day/);
});
