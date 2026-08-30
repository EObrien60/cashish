import { and, desc, eq, gte, isNotNull, lte } from "drizzle-orm";
import { db, first, schema, tenantId } from "@cashish/core/db";
import { money, round2, todayISO } from "./format";
import { notExcluded } from "./transactions";
import { computeVatReturn } from "./vat";
import { vatPeriods } from "./period";

const { categories, customers, invoices, payments, transactions } = schema;

// ---------------------------------------------------------------------------
// Financial health.
//
// Distinct from reports on purpose. Reports answer "what happened in a period";
// this answers "is the business all right, today". Everything here is as-of-now
// rather than period-scoped, because runway, what is already owed, how late the
// debtors are and what needs doing are all facts about this moment.
//
// Cash basis throughout, like the rest of the app: these figures come from bank
// transactions, not accruals.
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY);
const monthsBack = (ref: string, n: number) => {
  const d = new Date(ref + "T00:00:00Z");
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1)));
};

/** How many months of trailing history the burn rate is averaged over. */
const BURN_MONTHS = 3;

/**
 * The trailing window, and how many months it really spans.
 *
 * Both numbers have to come from one place. The window is the first of the month
 * BURN_MONTHS-1 back, so from the end of August it starts on 1 June — three calendar
 * months, not four. Going BURN_MONTHS back instead lands on 1 May and quietly divides
 * three months of spending over four, understating the burn by a quarter and
 * overstating the runway by a third.
 *
 * The divisor is the elapsed span rather than BURN_MONTHS, so a part-finished month
 * scales its part-month of spending correctly instead of reading as a slowdown.
 */
export function burnWindow(asOf: string) {
  const from = monthsBack(asOf, BURN_MONTHS - 1);
  return { from, to: asOf, months: Math.max(1, daysBetween(from, asOf) / 30.4375) };
}
/** Runway beyond this is reported as "comfortable" rather than a number. */
export const RUNWAY_CAP_MONTHS = 24;
/**
 * Below this, an overdue debt is not worth acting on. A rounding remainder left on an
 * otherwise settled invoice is real and stays in the aging and the total, but putting
 * "chase 9 cent" on someone's to-do list discredits the whole list.
 */
export const CHASE_FLOOR = 1;

export type Runway = {
  cash: number | null;
  cashAsOf: string | null;
  /** Average monthly net over the trailing window. Negative means burning. */
  monthlyNet: number;
  burning: boolean;
  /**
   * Months the cash lasts at the current burn. null when not burning — there is
   * no runway to speak of when the business funds itself, and a made-up number
   * there is worse than none.
   */
  months: number | null;
  /** True when the runway is longer than we bother counting. */
  comfortable: boolean;
  windowFrom: string;
  windowTo: string;
};

export type Commitment = {
  label: string;
  amount: number;
  detail: string;
  /** vat | payroll | tax | vendor */
  kind: string;
};

export type Committed = {
  items: Commitment[];
  total: number;
  /** Cash less what is already spoken for. Negative is the point of the block. */
  free: number | null;
};

export type AgingBucket = { label: string; amount: number; count: number };

export type Debtor = {
  customerId: string;
  customerName: string;
  number: string;
  outstanding: number;
  dueDate: string | null;
  daysOverdue: number;
};

export type Receivables = {
  total: number;
  count: number;
  overdue: number;
  buckets: AgingBucket[];
  /** Days sales outstanding, from real payment-to-invoice links. null if never paid. */
  dso: number | null;
  worst: Debtor[];
};

export type Direction = {
  months: { month: string; income: number; expense: number; net: number }[];
  revenue: { now: number; prior: number; change: number | null };
  expenses: { now: number; prior: number; change: number | null };
  net: { now: number; prior: number };
};

export type ConcentrationLine = { customerId: string; name: string; amount: number; share: number };

export type Concentration = {
  lines: ConcentrationLine[];
  topShare: number;
  top3Share: number;
  total: number;
  /** Fewer than this many paying customers makes the share figures noise. */
  thin: boolean;
};

export type Action = {
  label: string;
  detail: string;
  href: string;
  count: number;
  /** warn shows in the alarm colour; info is merely tidying. */
  tone: "warn" | "info";
};

export type Health = {
  asOf: string;
  runway: Runway;
  committed: Committed;
  receivables: Receivables;
  direction: Direction;
  concentration: Concentration;
  actions: Action[];
};

/** The VAT period containing a date, which is what the next return covers. */
export function currentVatPeriod(asOf: string) {
  const year = Number(asOf.slice(0, 4));
  return (
    vatPeriods(year).find((p) => p.from <= asOf && asOf <= p.to) ?? vatPeriods(year)[0]!
  );
}

/**
 * Runway from the bank balance and the trailing burn.
 *
 * The balance is the bank's own figure, so excluded rows still count — an internal
 * transfer does not change what is in the account, but the account is what it is.
 * The burn deliberately ignores excluded rows, because a transfer between own pots
 * is not spending and counting it would invent a burn that does not exist.
 */
export async function runway(asOf = todayISO()): Promise<Runway> {
  const tid = tenantId();
  const { from, months: span } = burnWindow(asOf);

  const [latest, rows] = await Promise.all([
    db
      .select({ balance: transactions.balance, date: transactions.bookedDate })
      .from(transactions)
      .where(and(eq(transactions.tenantId, tid), isNotNull(transactions.balance)))
      .orderBy(desc(transactions.bookedDate))
      .limit(1)
      .then(first),
    db
      .select({ amount: transactions.amount })
      .from(transactions)
      .where(
        and(
          eq(transactions.tenantId, tid),
          gte(transactions.bookedDate, from),
          lte(transactions.bookedDate, asOf),
          notExcluded(),
        ),
      ),
  ]);

  const net = round2(rows.reduce((sum, r) => sum + r.amount, 0));
  const monthlyNet = round2(net / span);
  const cash = latest?.balance ?? null;
  const burning = monthlyNet < 0;

  let months: number | null = null;
  let comfortable = false;
  if (burning && cash !== null && cash > 0) {
    const raw = cash / Math.abs(monthlyNet);
    comfortable = raw > RUNWAY_CAP_MONTHS;
    months = comfortable ? RUNWAY_CAP_MONTHS : Math.round(raw * 10) / 10;
  } else if (burning && cash !== null) {
    months = 0;
  }

  return { cash, cashAsOf: latest?.date ?? null, monthlyNet, burning, months, comfortable, windowFrom: from, windowTo: asOf };
}

/**
 * What the cash is already spoken for.
 *
 * The forward-looking half of the picture and the reason this is not a report.
 * VAT is the real computed figure for the current return; the rest are recurring
 * commitments averaged from what actually left the account, because a business
 * that has paid wages every month for a year will pay them again next month
 * whether or not a pay run has been entered.
 */
export async function committed(asOf = todayISO(), cash: number | null = null): Promise<Committed> {
  const tid = tenantId();
  const vatPeriod = currentVatPeriod(asOf);
  const { from: window, months: span } = burnWindow(asOf);

  const [vat, rows] = await Promise.all([
    computeVatReturn(vatPeriod.from, vatPeriod.to),
    db
      .select({
        amount: transactions.amount,
        employeeId: transactions.employeeId,
        vendorId: transactions.vendorId,
        categoryId: transactions.categoryId,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.tenantId, tid),
          gte(transactions.bookedDate, window),
          lte(transactions.bookedDate, asOf),
          notExcluded(),
        ),
      ),
  ]);

  const perMonth = (total: number) => round2(Math.abs(total) / span);

  const items: Commitment[] = [];
  if (vat.t3_payable > 0.005) {
    items.push({
      kind: "vat",
      label: "VAT on the current return",
      amount: round2(vat.t3_payable),
      detail: vatPeriod.label,
    });
  }

  const payroll = rows.filter((r) => r.employeeId && r.amount < 0).reduce((s, r) => s + r.amount, 0);
  if (payroll < -0.005) {
    items.push({
      kind: "payroll",
      label: "Payroll, monthly",
      amount: perMonth(payroll),
      detail: `average of the last ${BURN_MONTHS} months`,
    });
  }

  // Revenue payments other than the return above: PAYE, preliminary tax and the like.
  const catRows = await db.select().from(categories).where(eq(categories.tenantId, tid));
  const taxCategories = new Set(
    catRows.filter((c) => /tax|paye|revenue|vat/i.test(c.name)).map((c) => c.id),
  );
  const tax = rows
    .filter((r) => r.amount < 0 && !r.employeeId && r.categoryId && taxCategories.has(r.categoryId))
    .reduce((s, r) => s + r.amount, 0);
  if (tax < -0.005) {
    items.push({
      kind: "tax",
      label: "Other tax, monthly",
      amount: perMonth(tax),
      detail: `average of the last ${BURN_MONTHS} months`,
    });
  }

  const supplierSpend = rows
    .filter((r) => r.amount < 0 && r.vendorId && !r.employeeId)
    .reduce((s, r) => s + r.amount, 0);
  if (supplierSpend < -0.005) {
    items.push({
      kind: "vendor",
      label: "Suppliers, monthly",
      amount: perMonth(supplierSpend),
      detail: `average of the last ${BURN_MONTHS} months`,
    });
  }

  const total = round2(items.reduce((s, i) => s + i.amount, 0));
  return { items, total, free: cash === null ? null : round2(cash - total) };
}

/** Receivables, aged, with how long customers really take to pay. */
export async function receivables(asOf = todayISO()): Promise<Receivables> {
  const tid = tenantId();
  const [invRows, custRows, payRows] = await Promise.all([
    db.select().from(invoices).where(eq(invoices.tenantId, tid)),
    db.select().from(customers).where(eq(customers.tenantId, tid)),
    db.select().from(payments).where(eq(payments.tenantId, tid)),
  ]);
  const names = new Map(custRows.map((c) => [c.id, c.name]));

  // Draft invoices are excluded: nothing has been sent, so nobody owes it yet.
  // They surface in the action list instead, which is where an unsent invoice belongs.
  const live = invRows.filter((i) => i.status !== "void" && i.status !== "draft");

  const buckets: AgingBucket[] = [
    { label: "Not yet due", amount: 0, count: 0 },
    { label: "1–30 days", amount: 0, count: 0 },
    { label: "31–60 days", amount: 0, count: 0 },
    { label: "60+ days", amount: 0, count: 0 },
  ];
  const debtors: Debtor[] = [];
  let total = 0;
  let count = 0;
  let overdue = 0;

  for (const inv of live) {
    const owed = round2(inv.total - inv.amountPaid);
    if (owed <= 0.005) continue;
    total += owed;
    count += 1;
    const late = inv.dueDate && inv.dueDate < asOf ? daysBetween(inv.dueDate, asOf) : 0;
    if (late > 0) overdue += owed;
    const bucket = late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : 3;
    buckets[bucket]!.amount = round2(buckets[bucket]!.amount + owed);
    buckets[bucket]!.count += 1;
    debtors.push({
      customerId: inv.customerId,
      customerName: names.get(inv.customerId) ?? "(unknown customer)",
      number: inv.number,
      outstanding: owed,
      dueDate: inv.dueDate ?? null,
      daysOverdue: late,
    });
  }

  /*
   * Days sales outstanding, measured rather than modelled.
   *
   * Each settled invoice contributes the gap between issue and final payment,
   * weighted by its value — a €15,000 invoice paid in a week says more about the
   * business than a €70 one paid in ninety days. Only invoices that are actually
   * paid count; averaging in the unpaid ones would flatter or damn the figure
   * depending on which are outstanding today.
   */
  const byInvoice = new Map<string, string>();
  for (const p of payRows) {
    const existing = byInvoice.get(p.invoiceId);
    if (!existing || p.date > existing) byInvoice.set(p.invoiceId, p.date);
  }
  let weighted = 0;
  let weight = 0;
  for (const inv of live) {
    const settled = byInvoice.get(inv.id);
    if (!settled || round2(inv.total - inv.amountPaid) > 0.005) continue;
    const days = Math.max(0, daysBetween(inv.issueDate, settled));
    weighted += days * inv.total;
    weight += inv.total;
  }

  return {
    total: round2(total),
    count,
    overdue: round2(overdue),
    buckets,
    dso: weight > 0 ? Math.round(weighted / weight) : null,
    worst: debtors
      .filter((d) => d.daysOverdue > 0 && d.outstanding >= CHASE_FLOOR)
      .sort((a, b) => b.daysOverdue - a.daysOverdue || b.outstanding - a.outstanding)
      .slice(0, 4),
  };
}

/** Twelve months of income and spend, and how the last window compares. */
export async function direction(asOf = todayISO()): Promise<Direction> {
  const tid = tenantId();
  const from = monthsBack(asOf, 11);
  const rows = await db
    .select({ amount: transactions.amount, date: transactions.bookedDate })
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tid),
        gte(transactions.bookedDate, from),
        lte(transactions.bookedDate, asOf),
        notExcluded(),
      ),
    );

  const shape = new Map<string, { month: string; income: number; expense: number; net: number }>();
  for (let i = 11; i >= 0; i -= 1) {
    const month = monthsBack(asOf, i).slice(0, 7);
    shape.set(month, { month, income: 0, expense: 0, net: 0 });
  }
  for (const r of rows) {
    const slot = shape.get(r.date.slice(0, 7));
    if (!slot) continue;
    if (r.amount >= 0) slot.income = round2(slot.income + r.amount);
    else slot.expense = round2(slot.expense + Math.abs(r.amount));
    slot.net = round2(slot.income - slot.expense);
  }
  const months = [...shape.values()];

  // Compare the trailing window with the one before it — the same length, so the
  // comparison holds without knowing the financial year.
  const nowFrom = burnWindow(asOf).from.slice(0, 7);
  const priorFrom = monthsBack(asOf, BURN_MONTHS * 2 - 1).slice(0, 7);
  const sum = (list: typeof months, key: "income" | "expense") =>
    round2(list.reduce((s, m) => s + m[key], 0));
  const nowMonths = months.filter((m) => m.month >= nowFrom);
  const priorMonths = months.filter((m) => m.month >= priorFrom && m.month < nowFrom);

  const change = (now: number, prior: number) =>
    prior > 0.005 ? Math.round(((now - prior) / prior) * 1000) / 10 : null;
  const revenueNow = sum(nowMonths, "income");
  const revenuePrior = sum(priorMonths, "income");
  const expenseNow = sum(nowMonths, "expense");
  const expensePrior = sum(priorMonths, "expense");

  return {
    months,
    revenue: { now: revenueNow, prior: revenuePrior, change: change(revenueNow, revenuePrior) },
    expenses: { now: expenseNow, prior: expensePrior, change: change(expenseNow, expensePrior) },
    net: { now: round2(revenueNow - expenseNow), prior: round2(revenuePrior - expensePrior) },
  };
}

/** How much of the money in comes from too few places. */
export async function concentration(asOf = todayISO()): Promise<Concentration> {
  const tid = tenantId();
  const from = monthsBack(asOf, 11);
  const [rows, custRows] = await Promise.all([
    db
      .select({ amount: transactions.amount, customerId: transactions.customerId })
      .from(transactions)
      .where(
        and(
          eq(transactions.tenantId, tid),
          gte(transactions.bookedDate, from),
          lte(transactions.bookedDate, asOf),
          notExcluded(),
        ),
      ),
    db.select().from(customers).where(eq(customers.tenantId, tid)),
  ]);
  const names = new Map(custRows.map((c) => [c.id, c.name]));

  const byCustomer = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    if (r.amount <= 0 || !r.customerId) continue;
    total = round2(total + r.amount);
    byCustomer.set(r.customerId, round2((byCustomer.get(r.customerId) ?? 0) + r.amount));
  }

  const lines = [...byCustomer.entries()]
    .map(([customerId, amount]) => ({
      customerId,
      name: names.get(customerId) ?? "(unknown customer)",
      amount,
      share: total > 0 ? Math.round((amount / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    lines: lines.slice(0, 5),
    topShare: lines[0]?.share ?? 0,
    top3Share: Math.round(lines.slice(0, 3).reduce((s, l) => s + l.share, 0) * 10) / 10,
    total,
    thin: lines.length < 2,
  };
}

/** The short list of things actually worth doing, each one a link. */
export async function actions(asOf = todayISO()): Promise<Action[]> {
  const tid = tenantId();
  const { unmatchedInflows } = await import("./reconcile");
  const [txRows, invRows, unmatched] = await Promise.all([
    db
      .select({ id: transactions.id, categoryId: transactions.categoryId })
      .from(transactions)
      .where(and(eq(transactions.tenantId, tid), notExcluded())),
    db.select().from(invoices).where(eq(invoices.tenantId, tid)),
    unmatchedInflows({}),
  ]);

  const out: Action[] = [];

  const overdue = invRows.filter(
    (i) =>
      i.status !== "void" &&
      i.status !== "draft" &&
      round2(i.total - i.amountPaid) >= CHASE_FLOOR &&
      i.dueDate &&
      i.dueDate < asOf,
  );
  if (overdue.length) {
    out.push({
      tone: "warn",
      label: "Chase overdue invoices",
      detail: `${money(overdue.reduce((s, i) => s + (i.total - i.amountPaid), 0))} owed past its due date`,
      href: "/invoices",
      count: overdue.length,
    });
  }

  const drafts = invRows.filter((i) => i.status === "draft");
  if (drafts.length) {
    out.push({
      tone: "warn",
      label: "Send draft invoices",
      detail: "raised but never sent, so nobody is going to pay them",
      href: "/invoices",
      count: drafts.length,
    });
  }

  if (unmatched.length) {
    out.push({
      tone: "info",
      label: "Explain money received",
      detail: `${money(unmatched.reduce((s, u) => s + u.amount, 0))} in with no invoice linked`,
      href: "/transactions",
      count: unmatched.length,
    });
  }

  const uncategorised = txRows.filter((t) => !t.categoryId).length;
  if (uncategorised) {
    out.push({
      tone: "info",
      label: "Categorise transactions",
      detail: "uncategorised rows leave the VAT return and reports short",
      href: "/transactions?filter=uncategorized",
      count: uncategorised,
    });
  }

  return out;
}

export async function businessHealth(asOf = todayISO()): Promise<Health> {
  const cash = await runway(asOf);
  const [owed, ar, dir, conc, todo] = await Promise.all([
    committed(asOf, cash.cash),
    receivables(asOf),
    direction(asOf),
    concentration(asOf),
    actions(asOf),
  ]);
  return {
    asOf,
    runway: cash,
    committed: owed,
    receivables: ar,
    direction: dir,
    concentration: conc,
    actions: todo,
  };
}
