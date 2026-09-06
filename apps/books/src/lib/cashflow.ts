import { and, eq, gte, isNotNull, lte, desc, inArray } from "drizzle-orm";
import { db, schema, tenantId } from "@cashish/core/db";
import { round2 } from "./format";
import { notExcluded } from "./transactions";
import { firstMatch, listRules } from "./rules";
import { advanceDate, type RecurringFrequency } from "./recurring";
import { listVatRates } from "./lookups";

const {
  transactions,
  invoices,
  customers,
  vendors,
  employees,
  recurringInvoices,
  recurringInvoiceLines,
} = schema;

// ---------------------------------------------------------------------------
// The cash flow forecast.
//
// Months across, sources down: opening balance, income lines, total, expense
// lines, total, net, closing balance — which then opens the next month. The
// shape of the sheet a small business actually keeps.
//
// Everything here is DERIVED from the ledger and the invoice book. Nothing is
// stored, and there is no override: what cannot be known is left out rather
// than guessed at, and the exported sheet is where a plan gets added. That is
// a deliberate limit. A contract you have agreed but not yet invoiced is not
// in the books, so it cannot be in the forecast — export, type it in, and the
// sheet is yours.
//
// Two forecasts, one for each side:
//
//   Income   is committed money: what is owed on open invoices, landed in the
//            month it falls due, plus what recurring templates will raise. It
//            is not a projection of sales; guessing revenue from three months
//            of history is how a forecast starts lying.
//
//   Expenses ARE projected, because a business's outgoings really do repeat:
//            the same payroll, the same subscriptions, the same rent. A source
//            that appeared in at least half the months looked back over is
//            carried forward at the MEDIAN of those months. Median, not mean,
//            so one annual insurance premium does not inflate every month.
//
// The known ceiling: bi-monthly and quarterly outgoings — a VAT payment, an
// accountant's fee — appear in half the months or fewer and are dropped, which
// understates expenses. Catching them properly means detecting periodicity
// rather than counting months, and that is a bigger job than this sheet needs.
// The lookback is exposed so it can be widened, and the sheet is editable.
// ---------------------------------------------------------------------------

export type ForecastRow = {
  /** Stable within a run; used as a React key, not persisted. */
  key: string;
  label: string;
  /** One entry per month in the window, same order as `months`. */
  amounts: number[];
  /** Where the row came from, so the UI can say why a line is there. */
  basis: "open-invoice" | "recurring-invoice" | "repeating-expense";
};

export type ForecastMonth = {
  /** YYYY-MM */
  key: string;
  /** "September", or "Sep 2027" when the window spans more than one year. */
  label: string;
  from: string;
  to: string;
};

export type CashflowForecast = {
  from: string;
  to: string;
  months: ForecastMonth[];
  openingBalance: number;
  /** Opening balance per month; the first is `openingBalance`. */
  balances: number[];
  income: ForecastRow[];
  expenses: ForecastRow[];
  totalIncome: number[];
  totalExpenses: number[];
  netIncome: number[];
  closingBalance: number[];
  /** How the opening balance was arrived at, for the note under the sheet. */
  openingBasis: "bank-balance" | "ledger-sum";
  openingAsOf: string | null;
  lookbackMonths: number;
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const monthKey = (iso: string) => iso.slice(0, 7);

function monthStart(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

function monthEnd(year: number, month: number): string {
  // Day 0 of the next month is the last day of this one, leap years included.
  return new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
}

/** The months a window covers, inclusive of both ends' months. */
export function monthsBetween(from: string, to: string): ForecastMonth[] {
  const start = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  const out: ForecastMonth[] = [];
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  // A window is a sheet, not a query: refuse to build one wider than five years
  // rather than allocate for a typo in a date field.
  for (let guard = 0; guard < 60; guard++) {
    const first = monthStart(y, m);
    if (first > monthEnd(end.getUTCFullYear(), end.getUTCMonth())) break;
    out.push({ key: first.slice(0, 7), label: MONTH_NAMES[m], from: first, to: monthEnd(y, m) });
    if (y === end.getUTCFullYear() && m === end.getUTCMonth()) break;
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  // Bare month names are ambiguous once the window crosses a year, which the
  // ten-month sheet this was modelled on does.
  const years = new Set(out.map((mo) => mo.from.slice(0, 4)));
  if (years.size > 1) {
    for (const mo of out) {
      const idx = Number(mo.from.slice(5, 7)) - 1;
      mo.label = `${MONTH_NAMES[idx].slice(0, 3)} ${mo.from.slice(0, 4)}`;
    }
  }
  return out;
}

/** The default window: this month, plus the next nine. */
export function defaultWindow(todayISO: string): { from: string; to: string } {
  const d = new Date(todayISO + "T00:00:00Z");
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return { from: monthStart(y, m), to: monthEnd(y, m + 9) };
}

/**
 * The cash actually in the bank when the forecast starts.
 *
 * The bank's own running balance is authoritative when the statement carries
 * one, so it is preferred: it already includes anything excluded from the
 * books, and money moved out for a personal expense has still left the account.
 * Falling back to a signed sum of every transaction gives the same answer for a
 * statement that has been imported from the beginning, and a wrong one for a
 * partial import — which is why the basis is reported rather than hidden.
 */
async function openingBalanceAt(from: string): Promise<{
  balance: number;
  basis: "bank-balance" | "ledger-sum";
  asOf: string | null;
}> {
  const latest = await db
    .select({ balance: transactions.balance, bookedDate: transactions.bookedDate })
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tenantId()),
        isNotNull(transactions.balance),
        lte(transactions.bookedDate, from),
      ),
    )
    .orderBy(desc(transactions.bookedDate), desc(transactions.createdAt))
    .limit(1);

  if (latest[0]?.balance != null) {
    return { balance: round2(latest[0].balance), basis: "bank-balance", asOf: latest[0].bookedDate };
  }

  const rows = await db
    .select({ amount: transactions.amount, bookedDate: transactions.bookedDate })
    .from(transactions)
    .where(and(eq(transactions.tenantId, tenantId()), lte(transactions.bookedDate, from)));
  const sum = rows.reduce((acc, r) => acc + r.amount, 0);
  const asOf = rows.reduce<string | null>(
    (acc, r) => (acc === null || r.bookedDate > acc ? r.bookedDate : acc),
    null,
  );
  return { balance: round2(sum), basis: "ledger-sum", asOf };
}

/** Money owed on invoices that are still open, in the month each falls due. */
async function incomeFromOpenInvoices(months: ForecastMonth[]): Promise<ForecastRow[]> {
  const rows = await db
    .select({
      id: invoices.id,
      number: invoices.number,
      customerId: invoices.customerId,
      customerName: customers.name,
      status: invoices.status,
      dueDate: invoices.dueDate,
      issueDate: invoices.issueDate,
      total: invoices.total,
      amountPaid: invoices.amountPaid,
    })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .where(
      and(
        eq(invoices.tenantId, tenantId()),
        inArray(invoices.status, ["sent", "partial", "draft"]),
      ),
    );

  const first = months[0];
  const last = months[months.length - 1];
  const byCustomer = new Map<string, ForecastRow>();

  for (const inv of rows) {
    const outstanding = round2(inv.total - inv.amountPaid);
    if (outstanding <= 0) continue;

    // An invoice already overdue when the forecast starts is still money you
    // expect, so it lands in the first month rather than falling off the sheet.
    const due = inv.dueDate ?? inv.issueDate;
    const key = due < first.from ? first.key : monthKey(due);
    const index = months.findIndex((m) => m.key === key);
    if (index < 0) continue; // falls due after the window
    if (due > last.to) continue;

    const row =
      byCustomer.get(inv.customerId) ??
      ({
        key: `invoice:${inv.customerId}`,
        label: inv.customerName,
        amounts: months.map(() => 0),
        basis: "open-invoice" as const,
      } satisfies ForecastRow);
    row.amounts[index] = round2(row.amounts[index] + outstanding);
    byCustomer.set(inv.customerId, row);
  }

  return [...byCustomer.values()];
}

/**
 * What the recurring templates will raise inside the window.
 *
 * Walks each schedule forward with the same `advanceDate` that actually
 * generates the invoices, so the forecast lands the money in the month the
 * generator will really raise it in — including the month-end clamping that
 * turns a 31st into a 28th. Re-deriving the dates here would be a second
 * implementation to keep in step, and it would drift.
 */
async function incomeFromRecurring(months: ForecastMonth[]): Promise<ForecastRow[]> {
  const tid = tenantId();
  const [rows, lines, rates] = await Promise.all([
    db
      .select({
        id: recurringInvoices.id,
        customerId: recurringInvoices.customerId,
        customerName: customers.name,
        frequency: recurringInvoices.frequency,
        interval: recurringInvoices.interval,
        startDate: recurringInvoices.startDate,
        nextRunDate: recurringInvoices.nextRunDate,
        endDate: recurringInvoices.endDate,
        occurrencesLimit: recurringInvoices.occurrencesLimit,
        occurrencesCount: recurringInvoices.occurrencesCount,
      })
      .from(recurringInvoices)
      .innerJoin(customers, eq(customers.id, recurringInvoices.customerId))
      .where(and(eq(recurringInvoices.tenantId, tid), eq(recurringInvoices.status, "active"))),
    db.select().from(recurringInvoiceLines).where(eq(recurringInvoiceLines.tenantId, tid)),
    listVatRates(),
  ]);

  const rateFor = new Map(rates.map((r) => [r.id, r.rate]));
  const grossByTemplate = new Map<string, number>();
  for (const line of lines) {
    const vat = line.vatRateId ? (rateFor.get(line.vatRateId) ?? 0) : 0;
    const gross = line.quantity * line.unitPrice * (1 + vat);
    grossByTemplate.set(
      line.recurringId,
      round2((grossByTemplate.get(line.recurringId) ?? 0) + gross),
    );
  }

  const out: ForecastRow[] = [];
  const last = months[months.length - 1];

  for (const template of rows) {
    const total = grossByTemplate.get(template.id) ?? 0;
    if (total === 0) continue;

    const amounts = months.map(() => 0);
    const anchorDay = new Date(template.startDate + "T00:00:00Z").getUTCDate();
    const remaining =
      template.occurrencesLimit == null
        ? Number.POSITIVE_INFINITY
        : Math.max(0, template.occurrencesLimit - template.occurrencesCount);

    let cursor = template.nextRunDate;
    let raised = 0;
    // Guarded rather than while(true): a corrupt frequency must not spin.
    for (let guard = 0; guard < 240 && cursor <= last.to && raised < remaining; guard++) {
      if (template.endDate && cursor > template.endDate) break;
      const index = months.findIndex((m) => m.key === monthKey(cursor));
      if (index >= 0) amounts[index] = round2(amounts[index] + total);
      raised += 1;
      cursor = advanceDate(
        cursor,
        template.frequency as RecurringFrequency,
        Math.max(1, template.interval),
        anchorDay,
      );
    }

    if (amounts.some((a) => a !== 0)) {
      out.push({
        key: `recurring:${template.id}`,
        label: `${template.customerName} (recurring)`,
        amounts,
        basis: "recurring-invoice",
      });
    }
  }
  return out;
}

/**
 * Outgoings that repeat, carried forward.
 *
 * A source is whatever names the payment best: the vendor it was assigned to,
 * else the employee, else the rule that categorised it — which is why the rows
 * come out as "Vercel" and "Sarah Jane Hughes — payroll" rather than as bank
 * gibberish. Only when nothing claims it does the description stand in, folded
 * to its first few words so that "Tesco Galway 4471" and "Tesco Galway 8123"
 * are one line and not two.
 */
function sourceKey(
  t: typeof transactions.$inferSelect,
  names: { vendors: Map<string, string>; employees: Map<string, string> },
  ruleName: string | null,
): { key: string; label: string } {
  const vendor = t.vendorId ? names.vendors.get(t.vendorId) : undefined;
  if (vendor) return { key: `vendor:${t.vendorId}`, label: vendor };
  const employee = t.employeeId ? names.employees.get(t.employeeId) : undefined;
  if (employee) return { key: `employee:${t.employeeId}`, label: employee };
  if (ruleName) return { key: `rule:${ruleName.toLowerCase()}`, label: ruleName };
  const words = (t.description ?? "").trim().split(/\s+/).slice(0, 3).join(" ");
  const label = words || "Other";
  return { key: `text:${label.toLowerCase()}`, label };
}

async function repeatingExpenses(
  months: ForecastMonth[],
  from: string,
  lookbackMonths: number,
): Promise<ForecastRow[]> {
  // Whole months before the forecast starts. The month the forecast opens in is
  // excluded deliberately: it is usually part-elapsed, and a half month of
  // subscriptions read as a source that halved in price.
  const start = new Date(from + "T00:00:00Z");
  const lookbackFrom = monthStart(start.getUTCFullYear(), start.getUTCMonth() - lookbackMonths);
  const lookbackTo = monthEnd(start.getUTCFullYear(), start.getUTCMonth() - 1);

  const [rows, rules, vendorRows, employeeRows] = await Promise.all([
    db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.tenantId, tenantId()),
          gte(transactions.bookedDate, lookbackFrom),
          lte(transactions.bookedDate, lookbackTo),
          notExcluded(),
        ),
      ),
    listRules(),
    db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.tenantId, tenantId())),
    db
      .select({ id: employees.id, firstName: employees.firstName, familyName: employees.familyName })
      .from(employees)
      .where(eq(employees.tenantId, tenantId())),
  ]);

  const names = {
    vendors: new Map(vendorRows.map((v) => [v.id, v.name])),
    employees: new Map(
      employeeRows.map((e) => [e.id, `${e.firstName} ${e.familyName}`.trim() || "Employee"]),
    ),
  };

  // source -> month -> total spent that month
  const bySource = new Map<string, { label: string; months: Map<string, number> }>();

  for (const t of rows) {
    if (t.amount >= 0) continue; // outgoings only
    const rule = firstMatch(rules, t);
    const { key, label } = sourceKey(t, names, rule?.name || null);
    const bucket = bySource.get(key) ?? { label, months: new Map<string, number>() };
    const mk = monthKey(t.bookedDate);
    bucket.months.set(mk, round2((bucket.months.get(mk) ?? 0) + Math.abs(t.amount)));
    bySource.set(key, bucket);
  }

  const monthsLookedBack = Math.max(1, lookbackMonths);
  const threshold = Math.ceil(monthsLookedBack / 2);

  // A cost also has to be CURRENT, not merely frequent. A contractor who
  // invoiced for three months and finished still clears "half of the last six",
  // and projecting them forward overstates every month left on the sheet — the
  // direction of error that matters, because it is the one that says you can
  // afford something you cannot. Two months of grace rather than one, so a
  // subscription billed around the turn of a month is not dropped for landing
  // on the 1st instead of the 30th.
  const recent = new Set(
    [1, 2].map((back) => {
      const d = new Date(monthStart(start.getUTCFullYear(), start.getUTCMonth() - back));
      return d.toISOString().slice(0, 7);
    }),
  );

  const out: ForecastRow[] = [];

  for (const [key, bucket] of bySource) {
    const totals = [...bucket.months.values()];
    if (totals.length < threshold) continue; // not a repeating cost
    if (![...bucket.months.keys()].some((m) => recent.has(m))) continue; // stopped
    const sorted = [...totals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 1 ? sorted[mid] : round2((sorted[mid - 1] + sorted[mid]) / 2);
    if (round2(median) === 0) continue;
    out.push({
      key: `expense:${key}`,
      label: bucket.label,
      amounts: months.map(() => -round2(median)),
      basis: "repeating-expense",
    });
  }

  // Largest first: the rows that decide whether the business survives go top.
  return out.sort((a, b) => a.amounts[0] - b.amounts[0]);
}

export async function buildCashflowForecast(input: {
  from: string;
  to: string;
  lookbackMonths?: number;
}): Promise<CashflowForecast> {
  const lookbackMonths = Math.min(24, Math.max(1, input.lookbackMonths ?? 6));
  const months = monthsBetween(input.from, input.to);
  if (months.length === 0) throw new Error("The forecast window is empty.");

  const [opening, openInvoiceRows, recurringRows, expenseRows] = await Promise.all([
    openingBalanceAt(months[0].from),
    incomeFromOpenInvoices(months),
    incomeFromRecurring(months),
    repeatingExpenses(months, months[0].from, lookbackMonths),
  ]);

  // "Only include lines for sources that fall in the period" — a row of zeroes
  // is noise on a sheet someone has to read across ten columns.
  const nonZero = (r: ForecastRow) => r.amounts.some((a) => round2(a) !== 0);
  const income = [...openInvoiceRows, ...recurringRows].filter(nonZero);
  const expenses = expenseRows.filter(nonZero);

  const sumColumn = (rows: ForecastRow[], i: number) =>
    round2(rows.reduce((acc, r) => acc + r.amounts[i], 0));

  const totalIncome = months.map((_, i) => sumColumn(income, i));
  const totalExpenses = months.map((_, i) => sumColumn(expenses, i));
  const netIncome = months.map((_, i) => round2(totalIncome[i] + totalExpenses[i]));

  const balances: number[] = [];
  const closingBalance: number[] = [];
  let running = opening.balance;
  for (let i = 0; i < months.length; i++) {
    balances.push(round2(running));
    running = round2(running + netIncome[i]);
    closingBalance.push(running);
  }

  return {
    from: months[0].from,
    to: months[months.length - 1].to,
    months,
    openingBalance: opening.balance,
    balances,
    income,
    expenses,
    totalIncome,
    totalExpenses,
    netIncome,
    closingBalance,
    openingBasis: opening.basis,
    openingAsOf: opening.asOf,
    lookbackMonths,
  };
}
