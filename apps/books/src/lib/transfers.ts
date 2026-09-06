import { and, eq, inArray, isNull, sql } from "drizzle-orm";
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
//   2. "To X" / "From X" — optionally prefixed "Transfer to", "Payment to" —
//      where X names an account in this book, allowing for the bank decorating
//      the name: "To EUR Saving" is the account called "Saving".
//   3. The same shape where X is one of Revolut's own product words — Savings,
//      Credit, Pocket, a currency code. This is the rule that catches a card
//      payment on the FIRST import, before the card statement exists.
//
// What none of them can do is tell a move to your own account called "Ethan"
// from a payment to a person called Ethan. That is not a pattern problem, it is
// missing information, so it is asked rather than guessed: markTransfer is the
// answer, one click on the ledger, and reversible.
//
// Anything else is left alone. A wrongly detected transfer silently removes
// real spending from the books, which is a worse failure than missing one — a
// missed transfer is visible in the totals, a false one is not.
// ---------------------------------------------------------------------------

/** "Main · EUR → Main · GBP" — the shape Revolut writes an internal move in. */
const ARROW = /^(.+?)\s*(?:→|->|➔)\s*(.+)$/;

/**
 * "To Savings", "From Current", "Transfer to Savings", "Payment to Credit".
 *
 * The optional leading verb matters: Revolut writes a plain "To EUR" on one
 * product and "Transfer to …" on another, and the version without the verb was
 * the only one recognised — which is how €15,090 of "Transfer to …" ended up
 * counted as spending.
 */
const TO_FROM = /^(?:transfer|payment|sent|moved|move)?\s*(to|from)\s+(.{2,40})$/i;

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

/**
 * The account a phrase names, allowing for the bank decorating it.
 *
 * "To EUR Saving" is a move to the account called "Saving": the statement adds
 * the currency, the account list does not. Exact matching missed every one of
 * those — €29,388 of them on one book.
 *
 * Containment is only trusted for names of four characters or more, and only on
 * a word boundary. Without that, an account called "EUR" would claim "To EUR
 * Saving" AND every merchant with those three letters in it, and a false
 * transfer silently deletes real spending.
 */
function accountNamed(
  phrase: string,
  byName: Map<string, { id: string; name: string }>,
): { id: string; name: string } | undefined {
  const target = norm(phrase);
  const exact = byName.get(target);
  if (exact) return exact;

  let best: { id: string; name: string } | undefined;
  for (const [name, account] of byName) {
    if (name.length < 4) continue;
    const boundary = new RegExp(`(^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\s)`);
    if (boundary.test(target)) {
      // Prefer the longest match: "Main · GBP" over "Main" when both fit.
      if (!best || name.length > norm(best.name).length) best = account;
    }
  }
  return best;
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
        const named = accountNamed(target, byName as Map<string, { id: string; name: string }>);
        if (named) counterpart = named.name;
        else if (looksLikeOwnAccount(target)) counterpart = target;
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

  // One side is a line we recognised as a transfer and know the destination of.
  // The other is whatever the receiving statement happens to call it — and it
  // is usually NOT recognisable on its own: a savings statement records an
  // arriving €1,000 as "BUY EUR Class R", which names no account and looks like
  // any other credit. Pairing therefore matches a known transfer against
  // ordinary rows on the account it points at, rather than against other
  // recognised transfers, which is what an earlier version did and why a
  // deposit could be counted twice.
  const known = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tid),
        isNull(transactions.transferPeerId),
        sql`${transactions.transferAccountId} is not null`,
      ),
    );
  if (known.length === 0) return 0;

  const targets = [...new Set(known.map((t) => t.transferAccountId!))];
  const others = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tid),
        isNull(transactions.transferPeerId),
        inArray(transactions.accountId, targets),
      ),
    );

  const daysApart = (a: string, b: string) =>
    Math.abs(
      (new Date(a + "T00:00:00Z").getTime() - new Date(b + "T00:00:00Z").getTime()) / 86_400_000,
    );

  const taken = new Set<string>();
  let paired = 0;

  for (const t of known) {
    // When BOTH sides were recognised — "To Credit" here, "From Current"
    // there — each finds the other, and pairing them twice would report two
    // movements where there was one.
    if (taken.has(t.id)) continue;
    const match = others.find(
      (o) =>
        !taken.has(o.id) &&
        o.id !== t.id &&
        o.accountId === t.transferAccountId &&
        o.accountId !== t.accountId &&
        round2(o.amount) === round2(-t.amount) &&
        daysApart(o.bookedDate, t.bookedDate) <= windowDays,
    );
    if (!match) continue;

    taken.add(match.id);
    taken.add(t.id);
    paired += 1;
    await db.transaction(async (trx) => {
      await trx
        .update(transactions)
        .set({ transferPeerId: match.id })
        .where(and(eq(transactions.tenantId, tid), eq(transactions.id, t.id)));
      // The receiving line is the same movement, so it leaves the books too —
      // otherwise money arriving from your own account reads as income.
      await trx
        .update(transactions)
        .set({
          transferPeerId: t.id,
          transferAccountId: t.accountId,
          excluded: true,
          excludedReason: `Transfer ${match.amount < 0 ? "to" : "from"} ${
            (await getAccountName(trx, tid, t.accountId)) ?? "another account"
          }`,
        })
        .where(and(eq(transactions.tenantId, tid), eq(transactions.id, match.id)));
    });
  }

  return paired;
}

async function getAccountName(
  trx: { select: typeof db.select },
  tid: string,
  accountId: string | null,
): Promise<string | null> {
  if (!accountId) return null;
  const [row] = await trx
    .select({ name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.tenantId, tid), eq(accounts.id, accountId)))
    .limit(1);
  return row?.name ?? null;
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
