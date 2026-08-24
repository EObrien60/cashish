import { desc, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { round2 } from "./format";
import { listCustomers } from "./customers";

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

const OPEN_STATUSES = ["draft", "sent", "partial"];

/** Bank inflows with no payment linked to them yet. */
export function unmatchedInflows(options: { from?: string; to?: string; minAmount?: number } = {}) {
  const min = options.minAmount ?? 0.01;
  const linked = db
    .select({ transactionId: payments.transactionId })
    .from(payments)
    .where(isNotNull(payments.transactionId))
    .all()
    .map((row) => row.transactionId as string);

  return db
    .select()
    .from(transactions)
    .where(sql`${transactions.amount} >= ${min}`)
    .orderBy(desc(transactions.bookedDate))
    .all()
    .filter((tx) => !linked.includes(tx.id))
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
export function openInvoices() {
  const customers = new Map(listCustomers({ includeArchived: true }).map((c) => [c.id, c.name]));
  return db
    .select()
    .from(invoices)
    .where(sql`${invoices.status} in ('draft','sent','partial')`)
    .orderBy(desc(invoices.issueDate))
    .all()
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
export function suggestMatches(
  options: { from?: string; to?: string; minAmount?: number; tolerance?: number } = {},
): InflowMatch[] {
  const tolerance = options.tolerance ?? 0.02;
  const open = openInvoices();

  return unmatchedInflows(options).map((tx) => {
    const haystack = `${tx.description} ${tx.reference} ${tx.payer}`;
    const candidates: MatchCandidate[] = [];

    for (const invoice of open) {
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

    const rank = { high: 0, medium: 1, low: 2 } as const;
    candidates.sort((a, b) => rank[a.confidence] - rank[b.confidence] || a.outstanding - b.outstanding);
    return { transaction: tx, candidates };
  });
}

export type ReconcileReport = {
  unmatchedInflows: number;
  totalUnmatched: number;
  confidentMatches: InflowMatch[];
  needsDecision: InflowMatch[];
  /** Inflows with no candidate at all — most likely invoiced in the old system. */
  needsInvoice: Inflow[];
  openInvoicesAwaitingPayment: ReturnType<typeof openInvoices>;
};

export function reconcileReport(
  options: { from?: string; to?: string; minAmount?: number } = {},
): ReconcileReport {
  const matches = suggestMatches(options);
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
    openInvoicesAwaitingPayment: openInvoices(),
  };
}
