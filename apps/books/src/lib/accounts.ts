import { and, eq, sql } from "drizzle-orm";
import { db, first, schema, tenantId } from "@cashish/core/db";
import type { AccountKind } from "@cashish/core/db";
import { round2 } from "./format";
import { uid } from "./id";
import { isLiability } from "./account-kinds";

const { accounts, transactions } = schema;

// ---------------------------------------------------------------------------
// Accounts.
//
// A book has several: a current account, a credit card, a savings pot, a second
// currency. They are DISCOVERED rather than configured, because the statement
// already says which one it is — `Product` in a Revolut personal export,
// `Account` in a business one — and asking somebody to set up an account they
// have already told us about is a form to fill in for nothing.
//
// The same reasoning extends to the other side of a transfer: money that leaves
// the current account for a credit card has gone somewhere, and if that card
// has never been imported the account is created anyway, flagged `inferred`, so
// the money has a destination and stops being counted as spending. Its balance
// is then derived from those transfers alone — which is why the flag exists and
// is shown rather than hidden.
// ---------------------------------------------------------------------------

const ofTenant = () => eq(accounts.tenantId, tenantId());

/**
 * What Revolut calls an account, mapped to what it is.
 *
 * Personal exports put this in `Product`; business ones put a name like "Main"
 * or a currency code in `Account`. Anything unrecognised is a current account,
 * because that is what an unremarkable bank account is and a wrong `kind` is
 * cosmetic — it changes an icon, never a number.
 */
export function kindFromStatement(raw: string): AccountKind {
  const v = raw.toLowerCase().trim();
  if (!v) return "current";
  if (v.includes("credit") || v.includes("card")) return "credit_card";
  if (v.includes("saving") || v.includes("vault") || v.includes("deposit")) return "savings";
  if (v.includes("pocket") || v.includes("pot")) return "pocket";
  return "current";
}

/** "Main · GBP", "GBP account", "USD" — the currency a name declares, if any. */
export function currencyFromName(name: string): string | null {
  const m = /(?:^|[^A-Za-z])([A-Z]{3})(?:\s+account)?\s*$/.exec(name.trim());
  return m ? m[1] : null;
}

/** A tidy display name for what the statement called it. */
export function nameFromStatement(raw: string, fallback: string): string {
  const v = raw.trim();
  if (!v) return fallback;
  // Revolut writes a currency account as a bare code; "EUR account" reads better
  // in a list than "EUR", and matches how the app itself is worded.
  if (/^[A-Z]{3}$/.test(v)) return `${v} account`;
  return v;
}

export async function listAccounts(includeArchived = false) {
  const rows = await db
    .select()
    .from(accounts)
    .where(includeArchived ? ofTenant() : and(ofTenant(), eq(accounts.archived, false)))
    .orderBy(accounts.name);
  return rows;
}

export async function getAccount(id: string) {
  return first(await db.select().from(accounts).where(and(ofTenant(), eq(accounts.id, id))).limit(1));
}

/**
 * Finds an account by name, or creates it.
 *
 * Matching is case- and space-insensitive on both the name and the raw
 * statement value, so "Main · EUR", "main · eur" and a later rename to "Trading
 * EUR" all resolve to one account rather than three.
 */
export async function ensureAccount(input: {
  name: string;
  kind?: AccountKind;
  currency?: string;
  externalRef?: string;
  inferred?: boolean;
}): Promise<{ id: string; created: boolean }> {
  const tid = tenantId();
  const name = input.name.trim() || "Main";
  const ref = (input.externalRef ?? name).trim();

  const existing = first(
    await db
      .select({ id: accounts.id, inferred: accounts.inferred })
      .from(accounts)
      .where(
        and(
          eq(accounts.tenantId, tid),
          sql`(lower(trim(${accounts.name})) = lower(trim(${name}))
               or (${accounts.externalRef} <> '' and lower(trim(${accounts.externalRef})) = lower(trim(${ref}))))`,
        ),
      )
      .limit(1),
  );

  if (existing) {
    // An account first met as the far side of a transfer stops being a guess
    // the moment its own statement arrives.
    if (existing.inferred && input.inferred === false) {
      await db.update(accounts).set({ inferred: false }).where(eq(accounts.id, existing.id));
    }
    return { id: existing.id, created: false };
  }

  const id = uid();
  await db.insert(accounts).values({
    id,
    tenantId: tid,
    name,
    kind: input.kind ?? kindFromStatement(ref),
    // "Main · GBP" is a sterling account. Reading the currency off the name
    // matters for a balance derived from transfers: euro leaving a euro account
    // for a sterling one does not arrive as that many pounds, and a derived
    // figure has to know that it cannot say.
    currency: (currencyFromName(name) ?? input.currency ?? "EUR").toUpperCase(),
    externalRef: ref,
    inferred: input.inferred ?? false,
  });
  return { id, created: true };
}

export async function updateAccount(
  id: string,
  patch: Partial<{ name: string; kind: AccountKind; currency: string; openingBalance: number; archived: boolean }>,
) {
  await db.update(accounts).set(patch).where(and(ofTenant(), eq(accounts.id, id)));
}

export type AccountBalance = {
  id: string;
  name: string;
  kind: string;
  currency: string;
  inferred: boolean;
  archived: boolean;
  openingBalance: number;
  /** Opening balance plus everything on the account, transfers included. */
  balance: number;
  /**
   * The part of that balance that comes from transfers INTO this account whose
   * own statement has not been imported. Reported separately because it is the
   * one number here that is inferred rather than read off a statement.
   */
  derivedFromTransfers: number;
  /**
   * Money known to have moved here that cannot be counted, because it crossed
   * currencies and only the sending side's amount is known.
   */
  unknownIncoming: number;
  transactions: number;
  lastActivity: string | null;
};

/**
 * Balances, derived.
 *
 * Every line on the account counts here, including transfers and excluded rows:
 * this is what the bank thinks, not what the books count as income and
 * expenditure. Money moved to a savings pot has still left the current account,
 * and a balance that disagreed with the bank app would be worse than none.
 */
export async function accountBalances(includeArchived = false): Promise<AccountBalance[]> {
  const tid = tenantId();
  const rows = await listAccounts(includeArchived);

  const sums = await db
    .select({
      accountId: transactions.accountId,
      total: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
      n: sql<number>`count(*)`,
      last: sql<string | null>`max(${transactions.bookedDate})`,
    })
    .from(transactions)
    .where(eq(transactions.tenantId, tid))
    .groupBy(transactions.accountId);

  const byAccount = new Map(sums.map((s) => [s.accountId, s]));

  // Money sent to an account whose own statement has not arrived.
  //
  // Without this an inferred account reads €0.00 while the sending account is
  // €500 lighter, and the books plainly do not balance: the money left and went
  // nowhere. Only UNPAIRED transfers count — once the far side's own row exists
  // it is already in the sum above, and adding both would double it.
  const incoming = await db
    .select({
      accountId: transactions.transferAccountId,
      currency: transactions.currency,
      total: sql<number>`coalesce(sum(-${transactions.amount}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tid),
        sql`${transactions.transferAccountId} is not null`,
        sql`${transactions.transferPeerId} is null`,
      ),
    )
    .groupBy(transactions.transferAccountId, transactions.currency);

  return rows.map((a) => {
    const s = byAccount.get(a.id);
    const sent = incoming.filter((i) => i.accountId === a.id);
    // A euro leaving a euro account for a sterling one does not arrive as that
    // many pounds, and nothing in the statement says what it did arrive as. So
    // it is reported as known-but-uncountable rather than guessed at.
    const sameCurrency = sent.filter((i) => (i.currency ?? "EUR") === a.currency);
    const otherCurrency = sent.filter((i) => (i.currency ?? "EUR") !== a.currency);
    const derived = round2(sameCurrency.reduce((acc, i) => acc + Number(i.total), 0));
    const unknown = round2(otherCurrency.reduce((acc, i) => acc + Number(i.total), 0));

    return {
      id: a.id,
      name: a.name,
      kind: a.kind,
      currency: a.currency,
      inferred: a.inferred,
      archived: a.archived,
      openingBalance: round2(a.openingBalance),
      balance: round2(a.openingBalance + Number(s?.total ?? 0) + derived),
      derivedFromTransfers: derived,
      unknownIncoming: unknown,
      transactions: Number(s?.n ?? 0),
      lastActivity: s?.last ?? null,
    };
  });
}

/** Rows imported before accounts existed, and therefore on no account. */
export async function unassignedCount(): Promise<number> {
  const row = first(
    await db
      .select({ n: sql<number>`count(*)` })
      .from(transactions)
      .where(and(eq(transactions.tenantId, tenantId()), sql`${transactions.accountId} is null`))
      .limit(1),
  );
  return Number(row?.n ?? 0);
}

/** Puts every account-less transaction onto one account. */
export async function assignUnassigned(accountId: string): Promise<number> {
  const updated = await db
    .update(transactions)
    .set({ accountId })
    .where(and(eq(transactions.tenantId, tenantId()), sql`${transactions.accountId} is null`))
    .returning({ id: transactions.id });
  return updated.length;
}


// ---------------------------------------------------------------------------
// What a kind MEANS.
//
// A credit card is not an account with a negative balance in it; it is money
// you owe. Adding it to a current account balance to get "total held" produces
// a number that is neither what you have nor what you are worth. So accounts
// are grouped by what they are, and the two groups are shown apart before they
// are netted.
// ---------------------------------------------------------------------------

export { isLiability } from "./account-kinds";

export type AccountGroup = {
  currency: string;
  /** Current accounts, savings, pockets — money you have. */
  assets: AccountBalance[];
  /** Credit cards — money you owe. */
  liabilities: AccountBalance[];
  held: number;
  owed: number;
  /** Held less owed. The only figure that answers "how am I doing". */
  net: number;
  /** Of `held`, the part that is set aside rather than spendable. */
  saved: number;
};

/**
 * Accounts grouped by currency, then by what they are.
 *
 * Currencies are never added together: there is no exchange rate in the books
 * and inventing one would put a made-up number at the top of the page.
 */
export function groupAccounts(balances: AccountBalance[]): AccountGroup[] {
  const byCurrency = new Map<string, AccountBalance[]>();
  for (const a of balances) {
    if (a.archived) continue;
    byCurrency.set(a.currency, [...(byCurrency.get(a.currency) ?? []), a]);
  }

  return [...byCurrency.entries()]
    .map(([currency, list]) => {
      const assets = list.filter((a) => !isLiability(a.kind));
      const liabilities = list.filter((a) => isLiability(a.kind));
      const held = round2(assets.reduce((acc, a) => acc + a.balance, 0));
      // A card at -260 is 260 owed. Stored as the bank states it, shown as what
      // it means.
      const owed = round2(liabilities.reduce((acc, a) => acc + Math.min(0, a.balance), 0) * -1);
      const saved = round2(
        assets.filter((a) => a.kind === "savings").reduce((acc, a) => acc + a.balance, 0),
      );
      return { currency, assets, liabilities, held, owed, net: round2(held - owed), saved };
    })
    // The currency you hold most of, first.
    .sort((a, b) => b.held - a.held);
}


/**
 * Folds one account into another.
 *
 * The mistake this exists for is easy and, without it, permanent: a transfer
 * says "To Savings" so an account called Savings is created, and then the
 * savings statement is imported under the name Revolut actually gives it —
 * "Flexible savings". Two accounts, the same money, and a total that is
 * plainly wrong.
 *
 * Everything pointing at the source is repointed rather than copied: the
 * transactions that sat on it, and the transfers that pointed AT it from other
 * accounts. The source is then deleted, because leaving an empty duplicate
 * behind is how the list becomes untrustworthy.
 */
export async function mergeAccounts(
  fromId: string,
  intoId: string,
): Promise<{ moved: number; repointed: number }> {
  const tid = tenantId();
  if (fromId === intoId) return { moved: 0, repointed: 0 };

  const [source, target] = await Promise.all([getAccount(fromId), getAccount(intoId)]);
  if (!source || !target) throw new Error("Both accounts must exist in this book.");

  return db.transaction(async (trx) => {
    const moved = await trx
      .update(transactions)
      .set({ accountId: intoId })
      .where(and(eq(transactions.tenantId, tid), eq(transactions.accountId, fromId)))
      .returning({ id: transactions.id });

    const repointed = await trx
      .update(transactions)
      .set({ transferAccountId: intoId })
      .where(and(eq(transactions.tenantId, tid), eq(transactions.transferAccountId, fromId)))
      .returning({ id: transactions.id });

    // A real statement absorbing a guess makes the survivor real.
    if (target.inferred && !source.inferred) {
      await trx.update(accounts).set({ inferred: false }).where(eq(accounts.id, intoId));
    }

    await trx.delete(accounts).where(and(eq(accounts.tenantId, tid), eq(accounts.id, fromId)));
    return { moved: moved.length, repointed: repointed.length };
  });
}
