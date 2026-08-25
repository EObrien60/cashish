import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { tenantId } from "@/db/context";
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

/**
 * Candidate invoices for each unmatched inflow.
 *
 * Deliberately conservative: amount is the strong signal, the counterparty name
 * only raises confidence. Nothing is matched automatically — the caller decides.
 */
export async function suggestMatches(
  options: { from?: string; to?: string; minAmount?: number; tolerance?: number } = {},
): Promise<InflowMatch[]> {
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

      candidates.push({
        invoiceId: invoice.invoiceId,
        number: invoice.number,
        customerId: invoice.customerId,
        customerName: invoice.customerName,
        outstanding: invoice.outstanding,
        issueDate: invoice.issueDate,
        basis: exact ? (named ? "exact amount and name" : "exact amount") : close ? "close amount" : "name only",
        confidence: exact && named ? "high" : exact || close ? "medium" : "low",
      });
    }

    candidates.sort((a, b) => rank[a.confidence] - rank[b.confidence] || a.outstanding - b.outstanding);
    return { transaction: tx, candidates };
  });

  /*
   * Assign one invoice to at most one inflow.
   *
   * Scoring each inflow on its own is not enough: a client paying five identical monthly
   * invoices produces five identical amounts, every one of which scores perfectly against
   * every one of those invoices. Independently, all five name the same invoice and the
   * other four look unpaid. So the best pairs are taken first and each invoice is then out
   * of the running, oldest invoice first — which is also the order money is meant to
   * settle a ledger.
   */
  const pairs = scored.flatMap(({ transaction, candidates }) =>
    candidates.map((candidate) => ({
      txId: transaction.id,
      txDate: transaction.date,
      candidate,
    })),
  );
  pairs.sort(
    (a, b) =>
      rank[a.candidate.confidence] - rank[b.candidate.confidence] ||
      // Earliest money first, then earliest invoice.
      //
      // The payment date has to lead. An inflow can only settle an invoice that
      // already existed, so the oldest money has the fewest invoices available
      // to it. Ordering by invoice alone hands the oldest invoice to the newest
      // payment and strands the older ones with nothing left to claim — five
      // monthly payments against five monthly invoices then matched only three.
      a.txDate.localeCompare(b.txDate) ||
      a.candidate.issueDate.localeCompare(b.candidate.issueDate) ||
      a.candidate.outstanding - b.candidate.outstanding,
  );

  const claimedInvoice = new Set<string>();
  const assigned = new Map<string, string>(); // txId -> invoiceId
  for (const { txId, candidate } of pairs) {
    if (assigned.has(txId) || claimedInvoice.has(candidate.invoiceId)) continue;
    assigned.set(txId, candidate.invoiceId);
    claimedInvoice.add(candidate.invoiceId);
  }

  /* The assigned invoice leads; the rest stay listed, minus anything another inflow took. */
  return scored.map(({ transaction, candidates }) => {
    const mine = assigned.get(transaction.id);
    const ordered = [
      ...candidates.filter((c) => c.invoiceId === mine),
      ...candidates.filter((c) => c.invoiceId !== mine && !claimedInvoice.has(c.invoiceId)),
    ];
    return { transaction, candidates: ordered };
  });
}

export type ReconcileReport = {
  unmatchedInflows: number;
  totalUnmatched: number;
  confidentMatches: InflowMatch[];
  needsDecision: InflowMatch[];
  /** Inflows with no candidate at all — most likely invoiced in the old system. */
  needsInvoice: Inflow[];
  openInvoicesAwaitingPayment: Awaited<ReturnType<typeof openInvoices>>;
};

export async function reconcileReport(
  options: { from?: string; to?: string; minAmount?: number } = {},
): Promise<ReconcileReport> {
  const matches = await suggestMatches(options);
  const confident = matches.filter((m) => m.candidates[0]?.confidence === "high");
  const ambiguous = matches.filter(
    (m) => m.candidates.length > 0 && m.candidates[0]?.confidence !== "high",
  );
  const orphan = matches.filter((m) => m.candidates.length === 0).map((m) => m.transaction);

  return {
    unmatchedInflows: matches.length,
    totalUnmatched: round2(matches.reduce((sum, m) => sum + m.transaction.amount, 0)),
    confidentMatches: confident,
    needsDecision: ambiguous,
    needsInvoice: orphan,
    openInvoicesAwaitingPayment: await openInvoices(),
  };
}
