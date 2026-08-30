import { and, eq, gte, lte, isNotNull, sql } from "drizzle-orm";
import { db, schema, tenantId } from "@cashish/core/db";
import { round2 } from "./format";
import { notExcluded } from "./transactions";

const { transactions, categories, invoices, customers, invoiceLines } = schema;

// ---------------------------------------------------------------------------
// Management reporting: margins, where the money goes, and who it comes from.
//
// EVERYTHING HERE IS CASH BASIS. The figures come from bank transactions in a
// date range, not from accruals. That is the right basis for VAT here and for
// knowing what actually happened to the bank balance, but it means a month in
// which stock was bought and not yet sold shows a squeezed gross margin, and the
// month it sells shows an inflated one. For a reseller that distortion is
// material, so the UI says so rather than letting a percentage imply more
// precision than it has.
//
// Comparisons are against the immediately preceding window of the same length,
// which is the only comparison that is defensible without knowing the business's
// financial year.
// ---------------------------------------------------------------------------

const DAY = 86_400_000;

/**
 * The period to compare against.
 *
 * Calendar-aware on purpose. Equal-length arithmetic looks tidier but answers
 * the wrong question: July is 31 days, so "the 31 days before July" starts on
 * 31 May, and a user asking "how did this month go" means June. Whole months,
 * quarters and years compare with the previous one; a year-to-date range
 * compares with the same span last year, which is the only comparison that
 * survives seasonality. Anything else falls back to equal length, where there
 * is nothing better to assume.
 */
export function priorWindow(from: string, to: string): { from: string; to: string } {
  const a = new Date(from + "T00:00:00Z");
  const b = new Date(to + "T00:00:00Z");
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const lastOf = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0));

  const fy = a.getUTCFullYear();
  const fm = a.getUTCMonth();
  const fd = a.getUTCDate();
  const ty = b.getUTCFullYear();
  const tm = b.getUTCMonth();
  const td = b.getUTCDate();

  const startsMonth = fd === 1;
  const endsMonth = td === lastOf(ty, tm).getUTCDate();

  // A whole calendar year.
  if (startsMonth && fm === 0 && endsMonth && tm === 11 && fy === ty) {
    return { from: `${fy - 1}-01-01`, to: `${fy - 1}-12-31` };
  }
  // A whole calendar quarter.
  if (startsMonth && endsMonth && fy === ty && fm % 3 === 0 && tm === fm + 2) {
    const pq = new Date(Date.UTC(fy, fm - 3, 1));
    return { from: iso(pq), to: iso(lastOf(pq.getUTCFullYear(), pq.getUTCMonth() + 2)) };
  }
  // A whole calendar month.
  if (startsMonth && endsMonth && fy === ty && fm === tm) {
    const pm = new Date(Date.UTC(fy, fm - 1, 1));
    return { from: iso(pm), to: iso(lastOf(pm.getUTCFullYear(), pm.getUTCMonth())) };
  }
  // Year to date, or any range starting 1 January: same span, previous year.
  if (startsMonth && fm === 0 && fy === ty) {
    const end = new Date(Date.UTC(fy - 1, tm, td));
    // Guard 29 February, which does not exist in most previous years.
    const clamped = end.getUTCMonth() === tm ? end : lastOf(fy - 1, tm);
    return { from: `${fy - 1}-01-01`, to: iso(clamped) };
  }
  // Part of a single month (month to date): the same span a month earlier.
  if (startsMonth && fy === ty && fm === tm) {
    const pm = new Date(Date.UTC(fy, fm - 1, 1));
    const end = new Date(Date.UTC(pm.getUTCFullYear(), pm.getUTCMonth(), td));
    const clamped =
      end.getUTCMonth() === pm.getUTCMonth()
        ? end
        : lastOf(pm.getUTCFullYear(), pm.getUTCMonth());
    return { from: iso(pm), to: iso(clamped) };
  }

  // Fallback: the same number of days, immediately before.
  const span = Math.max(DAY, b.getTime() - a.getTime() + DAY);
  return {
    from: new Date(a.getTime() - span).toISOString().slice(0, 10),
    to: new Date(a.getTime() - DAY).toISOString().slice(0, 10),
  };
}

const pctChange = (now: number, before: number): number | null => {
  if (before === 0) return null; // "up from nothing" is not a percentage
  return round2(((now - before) / Math.abs(before)) * 100);
};

const share = (part: number, whole: number) => (whole === 0 ? 0 : round2((part / whole) * 100));

type Row = {
  amount: number;
  categoryId: string | null;
  kind: string | null;
  name: string | null;
  color: string | null;
  costOfSales: boolean | null;
};

async function rowsIn(from: string, to: string): Promise<Row[]> {
  const tid = tenantId();
  return db
    .select({
      amount: transactions.amount,
      categoryId: transactions.categoryId,
      kind: categories.kind,
      name: categories.name,
      color: categories.color,
      costOfSales: categories.costOfSales,
    })
    .from(transactions)
    // Left join: uncategorised transactions must still reach the totals, or the
    // report quietly disagrees with the bank.
    .leftJoin(
      categories,
      and(eq(transactions.categoryId, categories.id), eq(categories.tenantId, tid)),
    )
    .where(
      and(
        eq(transactions.tenantId, tid),
        gte(transactions.bookedDate, from),
        lte(transactions.bookedDate, to),
        notExcluded(),
      ),
    );
}

export type Margins = {
  revenue: number;
  costOfSales: number;
  grossProfit: number;
  grossMarginPct: number;
  overheads: number;
  operatingProfit: number;
  netMarginPct: number;
  uncategorised: { income: number; expense: number; count: number };
};

function foldMargins(rows: Row[]): Margins {
  let revenue = 0;
  let cos = 0;
  let overheads = 0;
  let uncatIn = 0;
  let uncatOut = 0;
  let uncatCount = 0;

  for (const r of rows) {
    const amt = r.amount;
    if (!r.categoryId || !r.kind) {
      uncatCount += 1;
      if (amt >= 0) uncatIn += amt;
      else uncatOut += Math.abs(amt);
      continue;
    }
    // Bucketed by the CATEGORY's kind, not by the sign, so a refund in an income
    // category still reduces nothing and a credit note lands in the right place.
    if (r.kind === "income") revenue += Math.abs(amt);
    else if (r.costOfSales) cos += Math.abs(amt);
    else overheads += Math.abs(amt);
  }

  // Uncategorised money still happened. Counting it in keeps the report honest;
  // it is reported separately so its effect on the margin is visible.
  revenue = round2(revenue + uncatIn);
  overheads = round2(overheads + uncatOut);
  cos = round2(cos);

  const grossProfit = round2(revenue - cos);
  const operatingProfit = round2(grossProfit - overheads);
  return {
    revenue,
    costOfSales: cos,
    grossProfit,
    grossMarginPct: share(grossProfit, revenue),
    overheads,
    operatingProfit,
    netMarginPct: share(operatingProfit, revenue),
    uncategorised: { income: round2(uncatIn), expense: round2(uncatOut), count: uncatCount },
  };
}

export type MarginReport = {
  period: { from: string; to: string };
  prior: { from: string; to: string };
  now: Margins;
  before: Margins;
  change: {
    revenue: number | null;
    grossProfit: number | null;
    operatingProfit: number | null;
    grossMarginPts: number;
    netMarginPts: number;
  };
};

export async function marginReport(from: string, to: string): Promise<MarginReport> {
  const prior = priorWindow(from, to);
  const [nowRows, beforeRows] = await Promise.all([rowsIn(from, to), rowsIn(prior.from, prior.to)]);
  const now = foldMargins(nowRows);
  const before = foldMargins(beforeRows);
  return {
    period: { from, to },
    prior,
    now,
    before,
    change: {
      revenue: pctChange(now.revenue, before.revenue),
      grossProfit: pctChange(now.grossProfit, before.grossProfit),
      operatingProfit: pctChange(now.operatingProfit, before.operatingProfit),
      // Margins move in percentage POINTS. Reporting a percentage change of a
      // percentage is how "margin up 40%" comes to mean 5% became 7%.
      grossMarginPts: round2(now.grossMarginPct - before.grossMarginPct),
      netMarginPts: round2(now.netMarginPct - before.netMarginPct),
    },
  };
}

export type SpendLine = {
  categoryId: string | null;
  name: string;
  color: string;
  costOfSales: boolean;
  amount: number;
  count: number;
  sharePct: number;
  priorAmount: number;
  changePct: number | null;
};

export type SpendReport = {
  total: number;
  priorTotal: number;
  changePct: number | null;
  lines: SpendLine[];
  counterparties: { name: string; amount: number; count: number; sharePct: number }[];
};

/** Where the money went: by category, and by who was paid. */
export async function spendReport(from: string, to: string): Promise<SpendReport> {
  const tid = tenantId();
  const prior = priorWindow(from, to);
  const [nowRows, beforeRows] = await Promise.all([rowsIn(from, to), rowsIn(prior.from, prior.to)]);

  const fold = (rows: Row[]) => {
    const m = new Map<string, SpendLine>();
    let total = 0;
    for (const r of rows) {
      if (r.amount >= 0) continue; // money out only
      if (r.kind === "income") continue; // a refund against income is not spend
      const key = r.categoryId ?? "__uncategorised";
      const line =
        m.get(key) ??
        ({
          categoryId: r.categoryId,
          name: r.name ?? "Uncategorised",
          color: r.color ?? "#9ca3af",
          costOfSales: !!r.costOfSales,
          amount: 0,
          count: 0,
          sharePct: 0,
          priorAmount: 0,
          changePct: null,
        } as SpendLine);
      line.amount = round2(line.amount + Math.abs(r.amount));
      line.count += 1;
      m.set(key, line);
      total = round2(total + Math.abs(r.amount));
    }
    return { map: m, total };
  };

  const current = fold(nowRows);
  const previous = fold(beforeRows);

  const lines = [...current.map.values()]
    .map((l) => {
      const key = l.categoryId ?? "__uncategorised";
      const priorAmount = previous.map.get(key)?.amount ?? 0;
      return {
        ...l,
        sharePct: share(l.amount, current.total),
        priorAmount,
        changePct: pctChange(l.amount, priorAmount),
      };
    })
    .sort((a, b) => b.amount - a.amount);

  // Who was actually paid. Grouped on the raw description, which is what the
  // bank gives; close enough to a supplier list to be useful and honest about
  // being derived rather than curated.
  const paid = await db
    .select({
      label: sql<string>`coalesce(nullif(${transactions.description}, ''), ${transactions.payer}, '(unnamed)')`,
      amount: sql<string>`sum(abs(${transactions.amount}))`,
      count: sql<string>`count(*)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tid),
        gte(transactions.bookedDate, from),
        lte(transactions.bookedDate, to),
        lte(transactions.amount, -0.005),
        notExcluded(),
      ),
    )
    .groupBy(
      sql`coalesce(nullif(${transactions.description}, ''), ${transactions.payer}, '(unnamed)')`,
    )
    .orderBy(sql`sum(abs(${transactions.amount})) desc`)
    .limit(15);

  return {
    total: current.total,
    priorTotal: previous.total,
    changePct: pctChange(current.total, previous.total),
    lines,
    counterparties: paid.map((p) => ({
      name: p.label,
      amount: round2(Number(p.amount)),
      count: Number(p.count),
      sharePct: share(Number(p.amount), current.total),
    })),
  };
}

export type RevenueReport = {
  invoicedTotal: number;
  customers: {
    id: string;
    name: string;
    invoiced: number;
    received: number;
    outstanding: number;
    sharePct: number;
    invoiceCount: number;
  }[];
  /** Share of invoiced revenue held by the largest customer. */
  topShare: number;
  /** Number of customers making up more than half the revenue. */
  customersToHalf: number;
};

/**
 * Revenue by customer, from invoices rather than from bank lines.
 *
 * Invoiced is the accrual view and the right one for concentration: who you
 * depend on is a question about the work, not about when the money landed.
 */
export async function revenueReport(from: string, to: string): Promise<RevenueReport> {
  const tid = tenantId();
  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      invoiced: sql<string>`sum(${invoices.total})`,
      received: sql<string>`sum(${invoices.amountPaid})`,
      count: sql<string>`count(*)`,
    })
    .from(invoices)
    .innerJoin(customers, and(eq(invoices.customerId, customers.id), eq(customers.tenantId, tid)))
    .where(
      and(
        eq(invoices.tenantId, tid),
        gte(invoices.issueDate, from),
        lte(invoices.issueDate, to),
        sql`${invoices.status} <> 'void'`,
      ),
    )
    .groupBy(customers.id, customers.name)
    .orderBy(sql`sum(${invoices.total}) desc`);

  const list = rows.map((r) => {
    const invoiced = round2(Number(r.invoiced));
    const received = round2(Number(r.received));
    return {
      id: r.id,
      name: r.name,
      invoiced,
      received,
      outstanding: round2(invoiced - received),
      invoiceCount: Number(r.count),
      sharePct: 0,
    };
  });
  const total = round2(list.reduce((s, c) => s + c.invoiced, 0));
  for (const c of list) c.sharePct = share(c.invoiced, total);

  let running = 0;
  let customersToHalf = 0;
  for (const c of list) {
    running += c.invoiced;
    customersToHalf += 1;
    if (running >= total / 2) break;
  }

  return {
    invoicedTotal: total,
    customers: list,
    topShare: list[0]?.sharePct ?? 0,
    customersToHalf: list.length ? customersToHalf : 0,
  };
}

export type TrendMonth = {
  month: string;
  revenue: number;
  costOfSales: number;
  overheads: number;
  grossProfit: number;
  grossMarginPct: number;
  net: number;
};

/** Month by month, so a trend is visible rather than inferred from one total. */
export async function trendReport(from: string, to: string): Promise<TrendMonth[]> {
  const tid = tenantId();
  // Its own query: the shared row shape drops the date, and this is the only
  // caller that needs it.
  const dated = await db
    .select({
      month: sql<string>`substring(${transactions.bookedDate}, 1, 7)`,
      amount: transactions.amount,
      kind: categories.kind,
      costOfSales: categories.costOfSales,
      categoryId: transactions.categoryId,
    })
    .from(transactions)
    .leftJoin(
      categories,
      and(eq(transactions.categoryId, categories.id), eq(categories.tenantId, tid)),
    )
    .where(
      and(
        eq(transactions.tenantId, tid),
        gte(transactions.bookedDate, from),
        lte(transactions.bookedDate, to),
        notExcluded(),
      ),
    );

  const m = new Map<string, TrendMonth>();
  for (const r of dated) {
    if (!r.month) continue;
    const t =
      m.get(r.month) ??
      ({
        month: r.month,
        revenue: 0,
        costOfSales: 0,
        overheads: 0,
        grossProfit: 0,
        grossMarginPct: 0,
        net: 0,
      } as TrendMonth);
    const abs = Math.abs(r.amount);
    if (!r.categoryId || !r.kind) {
      if (r.amount >= 0) t.revenue = round2(t.revenue + abs);
      else t.overheads = round2(t.overheads + abs);
    } else if (r.kind === "income") t.revenue = round2(t.revenue + abs);
    else if (r.costOfSales) t.costOfSales = round2(t.costOfSales + abs);
    else t.overheads = round2(t.overheads + abs);
    m.set(r.month, t);
  }

  return [...m.values()]
    .map((t) => {
      const grossProfit = round2(t.revenue - t.costOfSales);
      return {
        ...t,
        grossProfit,
        grossMarginPct: share(grossProfit, t.revenue),
        net: round2(grossProfit - t.overheads),
      };
    })
    .sort((a, b) => a.month.localeCompare(b.month));
}
