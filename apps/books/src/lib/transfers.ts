import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db, schema, tenantId } from "@cashish/core/db";
import { ensureAccount, listAccounts } from "./accounts";
import { round2 } from "./format";

const { transactions, accounts } = schema;

// ---------------------------------------------------------------------------
// Moving money between your own accounts.
//
// This is the one thing multiple accounts breaks if it is ignored. Paying a
// credit card off the current account is ONE movement that appears on TWO
// statements: money out of the current account, money into the card. Counted
// naively that is spending you did not do and income you did not receive, and
// both halves of a budget are wrong.
//
// So a transfer is recognised and taken out of the books — using the existing
// `excluded` flag, whose documented purpose already begins "internal pot
// transfers". Nothing in reports, VAT, budgets or the cash flow forecast had to
// learn a new concept; they all skip excluded rows already. The line stays
// visible in the Excluded tab with a reason that names the other account, so it
// is explained rather than hidden, and the decision can be undone.
//
// Detection is deliberately conservative. Three rules, each needing evidence
// from the statement itself:
//
//   1. Revolut names both ends of an internal move in the description:
//      "Main · EUR → Main · GBP". Both sides are read off it.
//   2. "To X" / "From X" where X is already an account in this book.
//   3. "To X" / "From X" where X is one of Revolut's own product words —
//      Savings, Credit, Pocket, a currency code. This is the rule that catches
//      a card payment on the FIRST import, before the card statement exists.
//
// Anything else is left alone. A wrongly detected transfer silently removes
// real spending from the books, which is a worse failure than missing one — a
// missed transfer is visible in the totals, a false one is not.
// ---------------------------------------------------------------------------

/** "Main · EUR → Main · GBP" — the shape Revolut writes an internal move in. */
const ARROW = /^(.+?)\s*(?:→|->|➔)\s*(.+)$/;

/** "To Savings", "From Current" — see TRUSTED below for when this is believed. */
const TO_FROM = /^(to|from)\s+(.{2,40})$/i;

/**
 * Revolut's own account vocabulary.
 *
 * "To Savings" and "To Credit" are internal by construction: these are the
 * names Revolut gives its products, not names a person chooses for a supplier.
 * Trusting them is what lets the first half of a card payment be recognised
 * BEFORE the card statement has ever been imported — which is the ordinary
 * case, because people export one account at a time.
 *
 * Deliberately a closed list rather than a heuristic. "To Sarah Jane Hughes" is
 * payroll and must stay in the books; the difference between it and "To
 * Savings" is not a pattern, it is a vocabulary.
 */
const PRODUCT_WORDS = new Set([
  "current",
  "savings",
  "saving",
  "credit",
  "credit card",
  "deposit",
  "pocket",
  "vault",
  "main",
  "flexible account",
  "flexible cash funds",
]);

/** Currency accounts are written as bare codes: "To EUR", "From GBP". */
const CURRENCY_CODE = /^[a-z]{3}( account)?$/;

function looksLikeOwnAccount(name: string): boolean {
  const v = name.toLowerCase().replace(/\s+/g, " ").trim();
  return PRODUCT_WORDS.has(v) || CURRENCY_CODE.test(v);
}

export type TransferHit = {
  transactionId: string;
  /** The account the money went to (money out) or came from (money in). */
  counterpartName: string;
  /** Whether that account had to be created to hold it. */
  createdAccount: boolean;
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Marks internal transfers and makes sure the far side exists.
 *
 * Runs over one import batch, or over the whole ledger when re-run by hand.
 * Returns what it did, because a function that silently reclassifies money
 * should be able to show its working.
 */
export async function detectTransfers(options: { batch?: string } = {}): Promise<{
  detected: number;
  accountsCreated: string[];
  hits: TransferHit[];
}> {
  const tid = tenantId();
  const known = await listAccounts(true);
  const byName = new Map(known.map((a) => [norm(a.name), a]));
  for (const a of known) if (a.externalRef) byName.set(norm(a.externalRef), a);

  const rows = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tid),
        options.batch ? eq(transactions.importBatch, options.batch) : sql`true`,
        // Already classified; leave it.
        isNull(transactions.transferAccountId),
      ),
    );

  const hits: TransferHit[] = [];
  const created = new Set<string>();

  for (const t of rows) {
    const description = (t.description ?? "").trim();
    if (!description) continue;

    let counterpart: string | null = null;

    const arrow = ARROW.exec(description);
    if (arrow) {
      const [, left, right] = arrow;
      // The line belongs to whichever end it left from; the other end is where
      // it went. Money out means this row is the left-hand side.
      counterpart = t.amount < 0 ? right.trim() : left.trim();
    } else {
      const toFrom = TO_FROM.exec(description);
      // Believed in two cases, and no others: the name is already an account in
      // this book, or it is one of Revolut's own product words. "To Sarah Jane
      // Hughes" is payroll and matches neither.
      if (toFrom) {
        const target = toFrom[2].trim();
        if (byName.has(norm(target)) || looksLikeOwnAccount(target)) counterpart = target;
      }
    }

    if (!counterpart) continue;
    // A transfer to the account it is already on is a parse artefact, not a move.
    if (t.accountId && byName.get(norm(counterpart))?.id === t.accountId) continue;

    const existing = byName.get(norm(counterpart));
    const account = existing
      ? { id: existing.id, created: false }
      : await ensureAccount({ name: counterpart, externalRef: counterpart, inferred: true });

    if (account.created) {
      created.add(counterpart);
      // So the next row in this same batch matches it rather than creating a second.
      const fresh = (await listAccounts(true)).find((a) => a.id === account.id);
      if (fresh) byName.set(norm(fresh.name), fresh);
    }

    await db
      .update(transactions)
      .set({
        transferAccountId: account.id,
        excluded: true,
        excludedReason: `Transfer ${t.amount < 0 ? "to" : "from"} ${counterpart}`,
      })
      .where(and(eq(transactions.tenantId, tid), eq(transactions.id, t.id)));

    hits.push({
      transactionId: t.id,
      counterpartName: counterpart,
      createdAccount: account.created,
    });
  }

  return { detected: hits.length, accountsCreated: [...created], hits };
}

/**
 * Links the two halves of a transfer once both have been imported.
 *
 * Pairing is a separate step from detection because the halves usually arrive
 * on different days, in different files: the current account statement in
 * March, the credit card in April. Detection has to work on one side alone;
 * pairing is what happens when the other turns up.
 *
 * A pair is two rows on DIFFERENT accounts, with opposite amounts to the cent,
 * booked within three days of each other, neither already paired. The date
 * window is because a transfer between two banks lands on the second one later
 * — within Revolut it is usually the same day, but a card payment is not.
 */
export async function pairTransfers(windowDays = 3): Promise<number> {
  const tid = tenantId();

  const candidates = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tid),
        isNull(transactions.transferPeerId),
        ne(transactions.excluded, false),
      ),
    );

  const outs = candidates.filter((t) => t.amount < 0);
  const ins = candidates.filter((t) => t.amount > 0);
  const takenIn = new Set<string>();
  let paired = 0;

  const daysApart = (a: string, b: string) =>
    Math.abs(
      (new Date(a + "T00:00:00Z").getTime() - new Date(b + "T00:00:00Z").getTime()) / 86_400_000,
    );

  for (const out of outs) {
    const match = ins.find(
      (i) =>
        !takenIn.has(i.id) &&
        round2(i.amount) === round2(-out.amount) &&
        i.accountId !== out.accountId &&
        daysApart(i.bookedDate, out.bookedDate) <= windowDays,
    );
    if (!match) continue;

    takenIn.add(match.id);
    paired += 1;
    await db.transaction(async (trx) => {
      await trx
        .update(transactions)
        .set({ transferPeerId: match.id, transferAccountId: match.accountId ?? out.transferAccountId })
        .where(and(eq(transactions.tenantId, tid), eq(transactions.id, out.id)));
      await trx
        .update(transactions)
        .set({ transferPeerId: out.id, transferAccountId: out.accountId ?? match.transferAccountId })
        .where(and(eq(transactions.tenantId, tid), eq(transactions.id, match.id)));
    });
  }

  return paired;
}

/** Undoes a detection: back into the books, off the transfer. */
export async function unmarkTransfer(id: string) {
  const tid = tenantId();
  await db
    .update(transactions)
    .set({ transferAccountId: null, transferPeerId: null, excluded: false, excludedReason: "" })
    .where(and(eq(transactions.tenantId, tid), eq(transactions.id, id)));
}

/** Marks a line as a transfer by hand, when the description gave nothing away. */
export async function markTransfer(id: string, counterpartAccountId: string) {
  const tid = tenantId();
  const [account] = await db
    .select({ name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.tenantId, tid), eq(accounts.id, counterpartAccountId)))
    .limit(1);
  const [row] = await db
    .select({ amount: transactions.amount })
    .from(transactions)
    .where(and(eq(transactions.tenantId, tid), eq(transactions.id, id)))
    .limit(1);

  await db
    .update(transactions)
    .set({
      transferAccountId: counterpartAccountId,
      excluded: true,
      excludedReason: `Transfer ${(row?.amount ?? 0) < 0 ? "to" : "from"} ${account?.name ?? "another account"}`,
    })
    .where(and(eq(transactions.tenantId, tid), eq(transactions.id, id)));
}
