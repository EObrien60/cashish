import { and, desc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { db, first, schema } from "@/db/client";
import { tenantId } from "@/db/context";
import { round2 } from "./format";
import { listCustomers } from "./customers";
import { notExcluded } from "./transactions";

const { invoices, payments, recurringInvoices, transactions } = schema;

// The integration surface.
//
// One versioned summary that other systems consume — Lunar first. Deliberately
// *state, not ledger*: balances, dates and schedules, never line items, categories
// or anything that would amount to keeping a second set of books somewhere else.
// Cashish stays the source of truth; consumers get enough to know who owes what
// and whether a recurring invoice has been raised.
//
// Bump SUMMARY_VERSION on any breaking change to the shape.

export const SUMMARY_VERSION = 1;

export type CustomerSummary = {
  id: string;
  name: string;
  email: string;
  invoicedTotal: number;
  received: number;
  outstanding: number;
  overdue: number;
  daysOverdueMax: number;
  openInvoices: number;
  lastInvoiceDate: string | null;
  lastPaymentDate: string | null;
};

export type RecurringSummary = {
  id: string;
  customerId: string;
  customerName: string;
  status: string;
  frequency: string;
  interval: number;
  nextRunDate: string;
  endDate: string | null;
  /** Most recent invoice raised for this customer, to spot a missed run. */
  lastInvoiceDate: string | null;
};

export type IntegrationSummary = {
  version: number;
  generatedAt: string;
  currency: string;
  asOf: string;
  customers: CustomerSummary[];
  recurring: RecurringSummary[];
  totals: {
    invoiced: number;
    received: number;
    outstanding: number;
    overdue: number;
    openInvoices: number;
  };
  bank: {
    /** Inflows with no invoice payment linked — work that may be unbilled or unmatched. */
    unmatchedInflowCount: number;
    unmatchedInflowTotal: number;
    lastTransactionDate: string | null;
    uncategorisedCount: number;
  };
};

const today = () => new Date().toISOString().slice(0, 10);

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

export async function buildIntegrationSummary(asOf = today()): Promise<IntegrationSummary> {
  const tid = tenantId();
  const [customerRows, invoiceRows, paymentRows] = await Promise.all([
    listCustomers({ includeArchived: true }),
    db.select().from(invoices).where(eq(invoices.tenantId, tid)).orderBy(desc(invoices.issueDate)),
    db.select().from(payments).where(eq(payments.tenantId, tid)),
  ]);

  const paymentsByInvoice = new Map<string, { date: string; amount: number }[]>();
  for (const payment of paymentRows) {
    const list = paymentsByInvoice.get(payment.invoiceId) ?? [];
    list.push({ date: payment.date, amount: payment.amount });
    paymentsByInvoice.set(payment.invoiceId, list);
  }

  const customers: CustomerSummary[] = customerRows.map((customer) => {
    const mine = invoiceRows.filter((invoice) => invoice.customerId === customer.id);
    const live = mine.filter((invoice) => invoice.status !== "void");

    let outstanding = 0;
    let overdue = 0;
    let daysOverdueMax = 0;
    let openInvoices = 0;
    let lastPaymentDate: string | null = null;

    for (const invoice of live) {
      const owed = round2(invoice.total - invoice.amountPaid);
      if (owed > 0.005) {
        outstanding += owed;
        openInvoices += 1;
        // Only a due date makes an invoice overdue; an undated one is merely open.
        if (invoice.dueDate && invoice.dueDate < asOf) {
          overdue += owed;
          daysOverdueMax = Math.max(daysOverdueMax, daysBetween(invoice.dueDate, asOf));
        }
      }
      for (const payment of paymentsByInvoice.get(invoice.id) ?? []) {
        if (!lastPaymentDate || payment.date > lastPaymentDate) lastPaymentDate = payment.date;
      }
    }

    return {
      id: customer.id,
      name: customer.name,
      email: customer.email ?? "",
      invoicedTotal: round2(live.reduce((sum, invoice) => sum + invoice.total, 0)),
      received: round2(live.reduce((sum, invoice) => sum + invoice.amountPaid, 0)),
      outstanding: round2(outstanding),
      overdue: round2(overdue),
      daysOverdueMax,
      openInvoices,
      lastInvoiceDate: live[0]?.issueDate ?? null,
      lastPaymentDate,
    };
  });

  const names = new Map(customerRows.map((customer) => [customer.id, customer.name]));
  const recurringRows = await db
    .select()
    .from(recurringInvoices)
    .where(eq(recurringInvoices.tenantId, tid));
  const recurring: RecurringSummary[] = recurringRows.map((row) => ({
      id: row.id,
      customerId: row.customerId,
      customerName: names.get(row.customerId) ?? "(unknown customer)",
      status: row.status,
      frequency: row.frequency,
      interval: row.interval,
      nextRunDate: row.nextRunDate,
      endDate: row.endDate ?? null,
      lastInvoiceDate:
        invoiceRows.find((invoice) => invoice.customerId === row.customerId)?.issueDate ?? null,
  }));

  const [linkedRows, inflowRows, lastTx, uncategorised] = await Promise.all([
    db
      .select({ transactionId: payments.transactionId })
      .from(payments)
      .where(and(eq(payments.tenantId, tid), isNotNull(payments.transactionId))),
    db
      .select()
      .from(transactions)
      .where(and(eq(transactions.tenantId, tid), gt(transactions.amount, 0), notExcluded())),
    db
      .select({ date: transactions.bookedDate })
      .from(transactions)
      .where(and(eq(transactions.tenantId, tid), notExcluded()))
      .orderBy(desc(transactions.bookedDate))
      .limit(1)
      .then(first),
    db
      .select({ n: sql<number>`count(*)` })
      .from(transactions)
      .where(
        and(eq(transactions.tenantId, tid), isNull(transactions.categoryId), notExcluded()),
      )
      .limit(1)
      .then(first),
  ]);
  const linkedTxIds = new Set(linkedRows.map((row) => row.transactionId as string));
  const inflows = inflowRows.filter((tx) => !linkedTxIds.has(tx.id));

  return {
    version: SUMMARY_VERSION,
    generatedAt: new Date().toISOString(),
    currency: "EUR",
    asOf,
    customers,
    recurring,
    totals: {
      invoiced: round2(customers.reduce((sum, c) => sum + c.invoicedTotal, 0)),
      received: round2(customers.reduce((sum, c) => sum + c.received, 0)),
      outstanding: round2(customers.reduce((sum, c) => sum + c.outstanding, 0)),
      overdue: round2(customers.reduce((sum, c) => sum + c.overdue, 0)),
      openInvoices: customers.reduce((sum, c) => sum + c.openInvoices, 0),
    },
    bank: {
      unmatchedInflowCount: inflows.length,
      unmatchedInflowTotal: round2(inflows.reduce((sum, tx) => sum + tx.amount, 0)),
      lastTransactionDate: lastTx?.date ?? null,
      uncategorisedCount: Number(uncategorised?.n ?? 0),
    },
  };
}

/** Guard for the HTTP surface. Absent token means the endpoint stays closed. */
export function integrationTokenMatches(provided: string | null): boolean {
  const expected = process.env.CASHISH_INTEGRATION_TOKEN;
  if (!expected) return false;
  if (!provided) return false;
  // Constant-time-ish: compare full strings of equal length only.
  if (provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}
