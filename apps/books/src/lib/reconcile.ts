import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { db, first, schema, tenantId } from "@cashish/core/db";
import { round2 } from "./format";
import { listCustomers } from "./customers";
import { notExcluded } from "./transactions";

const { invoices, payments, transactions } = schema;

// Reconciliation: matching money that arrived in the bank to the invoices that
// explain it.
//
// This is the awkward part of moving books into a new system. Bank inflows are
// facts; invoices may not exist yet because they were raised somewhere else. So
// rather than guessing, this produces three lists: inflows that clearly settle a
// known invoice, inflows that look like an invoice but cannot be matched, and
// invoices still waiting for money. What to do about each is a human decision.

export type Inflow = {
  id: string;
  date: string;
  amount: number;
  description: string;
  reference: string;
  payer: string;
  /** Set by the posting rules. The strong signal for whose invoices to consider. */
  customerId: string | null;
};

export type MatchCandidate = {
  invoiceId: string;
  number: string;
  customerId: string;
  customerName: string;
  outstanding: number;
  issueDate: string;
  /** exact | close | name_only */
  basis: string;
  confidence: "high" | "medium" | "low";
};

export type InflowMatch = {
  transaction: Inflow;
  candidates: MatchCandidate[];
};

/**
 * One transfer settling several invoices.
 *
 * A client on a retainer who also buys ad hoc tends to pay the month's invoices in
 * one go, so no single invoice ever equals the amount that arrived. The set does.
 */
export type BatchMatch = {
  transaction: Inflow;
  invoices: MatchCandidate[];
  /** What the invoices come to. */
  total: number;
  /** total - amount received. Positive means the payer rounded down or a fee was taken. */
  shortfall: number;
};

const OPEN_STATUSES: string[] = ["draft", "sent", "partial"];

/** Bank inflows with no payment linked to them yet. */
export async function unmatchedInflows(
  options: { from?: string; to?: string; minAmount?: number } = {},
) {
  const min = options.minAmount ?? 0.01;
  const tid = tenantId();
  const linked = new Set(
    (
      await db
        .select({ transactionId: payments.transactionId })
        .from(payments)
        .where(and(eq(payments.tenantId, tid), isNotNull(payments.transactionId)))
    ).map((row) => row.transactionId as string),
  );

  const rows = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.tenantId, tid), gte(transactions.amount, min), notExcluded()))
    .orderBy(desc(transactions.bookedDate));

  return rows
    .filter((tx) => !linked.has(tx.id))
    .filter((tx) => (options.from ? tx.bookedDate >= options.from : true))
    .filter((tx) => (options.to ? tx.bookedDate <= options.to : true))
    .map((tx) => ({
      id: tx.id,
      date: tx.bookedDate,
      amount: round2(tx.amount),
      description: tx.description ?? "",
      reference: tx.reference ?? "",
      payer: tx.payer ?? "",
      customerId: tx.customerId ?? null,
    }));
}

/** Invoices still owed money, with what is outstanding on each. */
export async function openInvoices() {
  const customers = new Map(
    (await listCustomers({ includeArchived: true })).map((c) => [c.id, c.name]),
  );
  const rows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.tenantId, tenantId()), inArray(invoices.status, OPEN_STATUSES)))
    .orderBy(desc(invoices.issueDate));
  return rows
    .map((invoice) => ({
      invoiceId: invoice.id,
      number: invoice.number,
      customerId: invoice.customerId,
      customerName: customers.get(invoice.customerId) ?? "(unknown customer)",
      total: round2(invoice.total),
      outstanding: round2(invoice.total - invoice.amountPaid),
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate ?? null,
      status: invoice.status,
    }))
    .filter((invoice) => invoice.outstanding > 0.005);
}

const mentions = (haystack: string, name: string): boolean => {
  const text = haystack.toLowerCase();
  // Match on the distinctive words of a customer name, not the whole string —
  // bank descriptions abbreviate ("BREAKTHROUGH MATHS LTD" -> "BTM MATHS").
  const words = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !["limited", "ltd", "the"].includes(word));
  return words.length > 0 && words.some((word) => text.includes(word));
};

/* How many invoices one transfer is allowed to settle, and how deep to search. */
const MAX_BATCH_INVOICES = 4;
const MAX_BATCH_POOL = 16;
/**
 * Rounding slack per invoice in a batch.
 *
 * A payer settling several invoices at once rounds, or the bank takes a few cent.
 * Any difference is reported as the batch's shortfall rather than hidden, and a batch
 * is never a confident match, so a person always sees it before it is written.
 */
const BATCH_SLACK_PER_INVOICE = 0.1;

type Open = Awaited<ReturnType<typeof openInvoices>>[number];

const batchSlack = (count: number, tolerance: number) =>
  Math.max(tolerance, BATCH_SLACK_PER_INVOICE * count);

/**
 * The set of invoices that together come to what arrived.
 *
 * Subset sum, bounded hard: one customer, at most MAX_BATCH_INVOICES invoices drawn
 * from the MAX_BATCH_POOL oldest eligible. Prefers the smallest set, then the closest
 * total, then the oldest invoices — so a batch is the least imaginative explanation
 * that fits, not the cleverest.
 */
function findBatch(amount: number, pool: Open[], tolerance: number): { invoices: Open[]; delta: number } | null {
  let best: { invoices: Open[]; delta: number } | null = null;
  const chosen: Open[] = [];
  const ceiling = batchSlack(MAX_BATCH_INVOICES, tolerance);

  const walk = (start: number, sum: number) => {
    if (chosen.length >= 2) {
      const delta = round2(sum - amount);
      if (Math.abs(delta) <= batchSlack(chosen.length, tolerance)) {
        const better =
          !best ||
          chosen.length < best.invoices.length ||
          (chosen.length === best.invoices.length && Math.abs(delta) < Math.abs(best.delta));
        if (better) best = { invoices: [...chosen], delta };
      }
    }
    if (chosen.length >= MAX_BATCH_INVOICES) return;
    for (let i = start; i < pool.length; i += 1) {
      const next = round2(sum + pool[i]!.outstanding);
      // Overshooting cannot be undone by adding more invoices.
      if (next - amount > ceiling) continue;
      chosen.push(pool[i]!);
      walk(i + 1, next);
      chosen.pop();
    }
  };

  walk(0, 0);
  return best;
}

const asCandidate = (invoice: Open, basis: string, confidence: MatchCandidate["confidence"]): MatchCandidate => ({
  invoiceId: invoice.invoiceId,
  number: invoice.number,
  customerId: invoice.customerId,
  customerName: invoice.customerName,
  outstanding: invoice.outstanding,
  issueDate: invoice.issueDate,
  basis,
  confidence,
});

/**
 * Candidate invoices for each unmatched inflow, and the batches some of them settle.
 *
 * Deliberately conservative: amount is the strong signal, the counterparty name only
 * raises confidence. Nothing is written — the caller decides.
 */
export async function suggestMatches(
  options: { from?: string; to?: string; minAmount?: number; tolerance?: number } = {},
): Promise<{ matches: InflowMatch[]; batches: BatchMatch[] }> {
  const tolerance = options.tolerance ?? 0.02;
  const [open, inflows] = await Promise.all([openInvoices(), unmatchedInflows(options)]);
  const rank = { high: 0, medium: 1, low: 2 } as const;

  /* Score every inflow against every open invoice. */
  const scored = inflows.map((tx) => {
    const haystack = `${tx.description} ${tx.reference} ${tx.payer}`;
    const candidates: MatchCandidate[] = [];

    for (const invoice of open) {
      // Money cannot settle an invoice that did not exist when it arrived.
      // Without this, an old inflow of the right size is matched to a much later
      // invoice on amount alone — which is how a payment ends up dated before
      // the document it pays, and cash-basis VAT is driven by payment dates.
      if (tx.date < invoice.issueDate) continue;

      const delta = Math.abs(invoice.outstanding - tx.amount);
      const named = mentions(haystack, invoice.customerName);
      const exact = delta <= tolerance;
      const close = !exact && delta <= Math.max(1, invoice.outstanding * 0.01);
      if (!exact && !close && !named) continue;

      candidates.push(
        asCandidate(
          invoice,
          exact ? (named ? "exact amount and name" : "exact amount") : close ? "close amount" : "name only",
          exact && named ? "high" : exact || close ? "medium" : "low",
        ),
      );
    }

    candidates.sort(
      (a, b) =>
        rank[a.confidence] - rank[b.confidence] ||
        a.outstanding - b.outstanding ||
        // Identical monthly invoices tie on both. Oldest first, or which invoice a
        // payment settles depends on the order the database happened to return them.
        a.issueDate.localeCompare(b.issueDate) ||
        a.number.localeCompare(b.number),
    );
    return { transaction: tx, candidates, haystack };
  });

  const byId = new Map(open.map((invoice) => [invoice.invoiceId, invoice]));
  const claimedInvoice = new Set<string>();
  const assigned = new Map<string, string>(); // txId -> invoiceId
  const batches = new Map<string, BatchMatch>(); // txId -> the set it settles

  /*
   * Pass one, oldest money first: only explanations that account for the amount to the
   * cent — one invoice that equals it, or the set of invoices that does.
   *
   * The order has to be chronological rather than by confidence, and that is the whole
   * fix. A client paying five identical retainers plus ad hoc work produces transfers
   * that are individually unremarkable; the earliest of them is a batch, and the later
   * lone ones are exact singles. Sorting by confidence puts those exact singles first,
   * they claim the OLDEST unclaimed retainer — one the earlier batch already paid — and
   * the retainers they really settled are left looking open. Going in date order lets the
   * earlier batch reserve its invoices before the later money is considered, which is
   * also the only order in which "an invoice must predate the money" means anything.
   */
  for (const { transaction, candidates, haystack } of [...scored].sort((a, b) =>
    a.transaction.date.localeCompare(b.transaction.date),
  )) {
    // Oldest first: a retainer client's invoices are identical, so without this the
    // month a payment settles is decided by row order.
    const exactSingle = candidates
      .filter(
        (candidate) =>
          !claimedInvoice.has(candidate.invoiceId) && candidate.basis.startsWith("exact amount"),
      )
      .sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.number.localeCompare(b.number))[0];
    if (exactSingle) {
      assigned.set(transaction.id, exactSingle.invoiceId);
      claimedInvoice.add(exactSingle.invoiceId);
      continue;
    }

    // Whose invoices could this be? The posting rules' attribution if there is one,
    // otherwise whoever the bank description names.
    const pool = open
      .filter((invoice) => !claimedInvoice.has(invoice.invoiceId))
      .filter((invoice) => invoice.issueDate <= transaction.date)
      .filter((invoice) =>
        transaction.customerId
          ? invoice.customerId === transaction.customerId
          : mentions(haystack, invoice.customerName),
      );
    // A batch spans one customer's invoices. If the description names more than one,
    // there is nothing to be confident about.
    if (new Set(pool.map((invoice) => invoice.customerId)).size !== 1) continue;

    const found = findBatch(
      transaction.amount,
      pool.sort((a, b) => a.issueDate.localeCompare(b.issueDate)).slice(0, MAX_BATCH_POOL),
      tolerance,
    );
    if (!found) continue;

    for (const invoice of found.invoices) claimedInvoice.add(invoice.invoiceId);
    batches.set(transaction.id, {
      transaction,
      invoices: found.invoices.map((invoice) =>
        asCandidate(invoice, "part of a batch", found.delta === 0 ? "high" : "medium"),
      ),
      total: round2(found.invoices.reduce((sum, invoice) => sum + invoice.outstanding, 0)),
      shortfall: found.delta,
    });
  }

  /*
   * Pass two: the weak explanations — a close amount, or nothing but a matching name.
   * Confidence leads here, so an early inflow that merely names a customer cannot take
   * an invoice that a later transfer settles exactly.
   */
  const pairs = scored
    .filter(({ transaction }) => !assigned.has(transaction.id) && !batches.has(transaction.id))
    .flatMap(({ transaction, candidates }) =>
      candidates.map((candidate) => ({ txId: transaction.id, txDate: transaction.date, candidate })),
    );
  pairs.sort(
    (a, b) =>
      rank[a.candidate.confidence] - rank[b.candidate.confidence] ||
      a.txDate.localeCompare(b.txDate) ||
      a.candidate.issueDate.localeCompare(b.candidate.issueDate) ||
      a.candidate.outstanding - b.candidate.outstanding,
  );
  for (const { txId, candidate } of pairs) {
    if (assigned.has(txId) || claimedInvoice.has(candidate.invoiceId)) continue;
    assigned.set(txId, candidate.invoiceId);
    claimedInvoice.add(candidate.invoiceId);
  }

  /* The assigned invoice leads; the rest stay listed, minus anything else took. */
  const matches = scored
    .filter(({ transaction }) => !batches.has(transaction.id))
    .map(({ transaction, candidates }) => {
      const mine = assigned.get(transaction.id);
      const ordered = [
        ...candidates.filter((c) => c.invoiceId === mine),
        ...candidates.filter((c) => c.invoiceId !== mine && !claimedInvoice.has(c.invoiceId)),
      ];
      return { transaction, candidates: ordered };
    });

  return {
    matches,
    batches: [...batches.values()].sort((a, b) =>
      a.transaction.date.localeCompare(b.transaction.date),
    ),
  };
}

export type ReconcileReport = {
  unmatchedInflows: number;
  totalUnmatched: number;
  confidentMatches: InflowMatch[];
  needsDecision: InflowMatch[];
  /** Inflows with no candidate at all — most likely invoiced in the old system. */
  needsInvoice: Inflow[];
  /**
   * Transfers that settle several invoices at once. Never confident: a person confirms
   * the set, then applyBatchMatch writes it.
   */
  batchMatches: BatchMatch[];
  openInvoicesAwaitingPayment: Awaited<ReturnType<typeof openInvoices>>;
};

export async function reconcileReport(
  options: { from?: string; to?: string; minAmount?: number } = {},
): Promise<ReconcileReport> {
  const { matches, batches } = await suggestMatches(options);
  const confident = matches.filter((m) => m.candidates[0]?.confidence === "high");
  const ambiguous = matches.filter(
    (m) => m.candidates.length > 0 && m.candidates[0]?.confidence !== "high",
  );
  const orphan = matches.filter((m) => m.candidates.length === 0).map((m) => m.transaction);
  const everything = [...matches.map((m) => m.transaction), ...batches.map((b) => b.transaction)];

  return {
    unmatchedInflows: everything.length,
    totalUnmatched: round2(everything.reduce((sum, tx) => sum + tx.amount, 0)),
    confidentMatches: confident,
    needsDecision: ambiguous,
    needsInvoice: orphan,
    batchMatches: batches,
    openInvoicesAwaitingPayment: await openInvoices(),
  };
}

/**
 * Write a batch: one transfer, several invoices.
 *
 * Settles them oldest first, so any shortfall lands on the newest invoice of the set
 * and leaves it partial — the same order money is meant to clear a ledger, and it keeps
 * the remainder on the invoice a person is most likely to be still chasing.
 *
 * Refuses to write more than arrived. The allocation is capped at the transfer amount,
 * so a set totalling more than the money simply leaves the last invoice short.
 */
export async function applyBatchMatch(
  transactionId: string,
  invoiceIds: string[],
  options: { date?: string; note?: string; method?: string } = {},
) {
  const { recordPayment, getInvoice } = await import("./invoices");
  const tid = tenantId();
  const tx = first(
    await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.tenantId, tid), eq(transactions.id, transactionId)))
      .limit(1),
  );
  if (!tx) throw new Error(`No transaction ${transactionId}`);
  if (tx.amount <= 0) throw new Error("A batch settles money in, and this transaction is money out");

  const wanted = await Promise.all(invoiceIds.map((id) => getInvoice(id)));
  const invoices = wanted.filter(Boolean) as NonNullable<(typeof wanted)[number]>[];
  if (invoices.length !== invoiceIds.length) throw new Error("One of those invoices does not exist");
  if (invoices.length < 2) throw new Error("A batch needs at least two invoices");

  const date = options.date ?? tx.bookedDate;
  for (const invoice of invoices) {
    if (date < invoice.issueDate) {
      throw new Error(`${invoice.number} was raised on ${invoice.issueDate}, after this money arrived`);
    }
  }

  const ordered = [...invoices].sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.number.localeCompare(b.number));
  let left = round2(tx.amount);
  const written: { number: string; amount: number }[] = [];
  for (const invoice of ordered) {
    if (left <= 0.005) break;
    const owed = round2(invoice.total - invoice.amountPaid);
    const amount = round2(Math.min(owed, left));
    await recordPayment(invoice.id, {
      date,
      amount,
      method: options.method ?? "bank",
      transactionId,
      note: options.note ?? `Part of one transfer settling ${ordered.length} invoices`,
    });
    written.push({ number: invoice.number, amount });
    left = round2(left - amount);
  }

  return { written, unallocated: left };
}
