import { and, asc, eq, gte, sql } from "drizzle-orm";
import { db, schema, tenantId } from "@cashish/core/db";
import { round2 } from "./format";

const { transactions } = schema;

// ---------------------------------------------------------------------------
// One account, looked at closely.
//
// The question a savings account raises is not "what is the balance" — the
// list already says that — it is "how much of this did I earn and how much did
// I just move here". Those are different achievements and adding them together
// hides the only one you have any control over.
//
// The split is derivable rather than guessed: a line that is part of a transfer
// between your own accounts is money moved, and everything else is the account
// doing something on its own — interest, a fee, a card payment, a direct debit.
// No provider-specific words are needed for that, which is why it works the
// same on a Revolut savings fund and a credit card.
// ---------------------------------------------------------------------------

export type MonthPoint = {
  /** YYYY-MM */
  month: string;
  in: number;
  out: number;
  net: number;
  /** Balance at the end of this month. */
  closing: number;
};

export type AccountAnalysis = {
  months: MonthPoint[];
  /** Money moved in from your own accounts. */
  transferredIn: number;
  /** Money moved back out to them. */
  transferredOut: number;
  /** Everything else that arrived: interest, refunds, customers paying you. */
  earned: number;
  /** Everything else that left: fees, tax, spending. */
  spent: number;
  /** Closing less opening across the whole period. */
  growth: number;
  /** growth less the net of what you moved in — what the account did by itself. */
  growthFromAccount: number;
  /**
   * Whether `growthFromAccount` can honestly be called a return.
   *
   * It cannot when large sums arrived without a matching transfer from another
   * account, because a deposit and a return are indistinguishable from one
   * side of the story: importing only a savings statement makes every deposit
   * look like interest. The threshold is a share of the account's peak
   * balance, since a real return is small relative to the balance and a
   * deposit generally is not.
   */
  returnIsKnowable: boolean;
  /** Money in and out with no matching transfer — what makes the above false. */
  unmatchedIn: number;
  unmatchedOut: number;
  first: string | null;
  last: string | null;
  /** The biggest recurring lines on this account, by total. */
  topLines: { label: string; total: number; count: number }[];
};

const monthOf = (iso: string) => iso.slice(0, 7);

function addMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

/**
 * Everything the account detail page needs, in one pass over its rows.
 *
 * Excluded rows are INCLUDED here, deliberately: this is the account, not the
 * books. Money moved to a savings pot has still left the current account, and a
 * balance that disagreed with the bank app would be worse than none — the same
 * reasoning as `accountBalances`.
 */
export async function analyseAccount(
  accountId: string,
  options: { openingBalance?: number; from?: string } = {},
): Promise<AccountAnalysis> {
  const rows = await db
    .select({
      bookedDate: transactions.bookedDate,
      amount: transactions.amount,
      description: transactions.description,
      transferAccountId: transactions.transferAccountId,
      transferPeerId: transactions.transferPeerId,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tenantId()),
        eq(transactions.accountId, accountId),
        ...(options.from ? [gte(transactions.bookedDate, options.from)] : []),
      ),
    )
    .orderBy(asc(transactions.bookedDate));

  const empty: AccountAnalysis = {
    months: [],
    transferredIn: 0,
    transferredOut: 0,
    earned: 0,
    spent: 0,
    growth: 0,
    growthFromAccount: 0,
    returnIsKnowable: true,
    unmatchedIn: 0,
    unmatchedOut: 0,
    first: null,
    last: null,
    topLines: [],
  };
  if (rows.length === 0) return empty;

  const byMonth = new Map<string, { in: number; out: number }>();
  /** The largest single inflow that no transfer explains. */
  let biggestUnmatchedIn = 0;
  const lines = new Map<string, { total: number; count: number }>();
  let transferredIn = 0;
  let transferredOut = 0;
  let earned = 0;
  let spent = 0;

  for (const r of rows) {
    const m = monthOf(r.bookedDate);
    const bucket = byMonth.get(m) ?? { in: 0, out: 0 };
    if (r.amount >= 0) bucket.in += r.amount;
    else bucket.out += Math.abs(r.amount);
    byMonth.set(m, bucket);

    // A row is "moved" if it is either half of a transfer between your own
    // accounts: the side that names the destination, or the side that was
    // matched to it.
    const isMoved = Boolean(r.transferAccountId || r.transferPeerId);
    if (isMoved) {
      if (r.amount >= 0) transferredIn += r.amount;
      else transferredOut += Math.abs(r.amount);
    } else if (r.amount >= 0) {
      earned += r.amount;
      biggestUnmatchedIn = Math.max(biggestUnmatchedIn, r.amount);
    } else {
      spent += Math.abs(r.amount);
    }

    // Folded to the first few words so "Return PAID EUR Class R IE000AZVL3K0"
    // and its 809 siblings are one line rather than eight hundred.
    const label = (r.description ?? "").trim().split(/\s+/).slice(0, 3).join(" ") || "Unnamed";
    const seen = lines.get(label) ?? { total: 0, count: 0 };
    seen.total += r.amount;
    seen.count += 1;
    lines.set(label, seen);
  }

  // A continuous run of months, so a gap in activity reads as a flat line
  // rather than being silently skipped.
  const first = monthOf(rows[0].bookedDate);
  const last = monthOf(rows[rows.length - 1].bookedDate);
  const months: MonthPoint[] = [];
  let running = options.openingBalance ?? 0;
  for (let m = first, guard = 0; guard < 600; guard++) {
    const b = byMonth.get(m) ?? { in: 0, out: 0 };
    const net = round2(b.in - b.out);
    running = round2(running + net);
    months.push({ month: m, in: round2(b.in), out: round2(b.out), net, closing: running });
    if (m === last) break;
    m = addMonth(m, 1);
  }

  const opening = options.openingBalance ?? 0;
  const growth = round2(running - opening);
  const movedNet = round2(transferredIn - transferredOut);

  // A return is small next to the balance; a deposit is not. One unexplained
  // inflow worth more than a fiftieth of the peak balance is enough to make
  // "what this account earned" a number nobody should trust.
  const peak = Math.max(...months.map((m) => Math.abs(m.closing)), 1);
  const returnIsKnowable = biggestUnmatchedIn <= peak * 0.02;

  return {
    months,
    transferredIn: round2(transferredIn),
    transferredOut: round2(transferredOut),
    earned: round2(earned),
    spent: round2(spent),
    growth,
    // What the account did on its own, once the money you carried in and out
    // of it is taken away. On a savings fund this is the actual return.
    growthFromAccount: round2(growth - movedNet),
    returnIsKnowable,
    unmatchedIn: round2(earned),
    unmatchedOut: round2(spent),
    first: rows[0].bookedDate,
    last: rows[rows.length - 1].bookedDate,
    topLines: [...lines.entries()]
      .map(([label, v]) => ({ label, total: round2(v.total), count: v.count }))
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
      .slice(0, 8),
  };
}
