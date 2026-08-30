import { db, first, schema } from "@/db/client";
import { tenantId } from "@/db/context";
import { and, desc, eq, gte, isNotNull, lte } from "drizzle-orm";
import { round2 } from "./format";
import { notExcluded } from "./transactions";

const { transactions, categories, invoices } = schema;

export type CategoryLine = {
  categoryId: string | null;
  name: string;
  kind: string;
  total: number;
  count: number;
};

export type ProfitAndLoss = {
  from: string;
  to: string;
  income: CategoryLine[];
  expenses: CategoryLine[];
  totalIncome: number;
  totalExpense: number;
  net: number;
  uncategorizedIncome: number;
  uncategorizedExpense: number;
};

function txInRange(from: string, to: string) {
  return db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tenantId()),
        gte(transactions.bookedDate, from),
        lte(transactions.bookedDate, to),
        notExcluded(),
      ),
    );
}

export async function profitAndLoss(from: string, to: string): Promise<ProfitAndLoss> {
  const [catRows, rows] = await Promise.all([
    db.select().from(categories).where(eq(categories.tenantId, tenantId())),
    txInRange(from, to),
  ]);
  const cats = new Map(catRows.map((c) => [c.id, c]));

  const buckets = new Map<string, CategoryLine>();
  let uncategorizedIncome = 0;
  let uncategorizedExpense = 0;

  for (const t of rows) {
    const amt = round2(t.amount);
    if (!t.categoryId) {
      if (amt >= 0) uncategorizedIncome += amt;
      else uncategorizedExpense += Math.abs(amt);
      continue;
    }
    const cat = cats.get(t.categoryId);
    const key = t.categoryId;
    const cur =
      buckets.get(key) ??
      ({
        categoryId: t.categoryId,
        name: cat?.name ?? "Unknown",
        kind: cat?.kind ?? (amt >= 0 ? "income" : "expense"),
        total: 0,
        count: 0,
      } as CategoryLine);
    cur.total = round2(cur.total + Math.abs(amt));
    cur.count += 1;
    buckets.set(key, cur);
  }

  const income = [...buckets.values()].filter((b) => b.kind === "income");
  const expenses = [...buckets.values()].filter((b) => b.kind === "expense");
  income.sort((a, b) => b.total - a.total);
  expenses.sort((a, b) => b.total - a.total);

  if (uncategorizedIncome > 0)
    income.push({ categoryId: null, name: "Uncategorised", kind: "income", total: round2(uncategorizedIncome), count: 0 });
  if (uncategorizedExpense > 0)
    expenses.push({ categoryId: null, name: "Uncategorised", kind: "expense", total: round2(uncategorizedExpense), count: 0 });

  const totalIncome = round2(income.reduce((s, b) => s + b.total, 0));
  const totalExpense = round2(expenses.reduce((s, b) => s + b.total, 0));

  return {
    from,
    to,
    income,
    expenses,
    totalIncome,
    totalExpense,
    net: round2(totalIncome - totalExpense),
    uncategorizedIncome: round2(uncategorizedIncome),
    uncategorizedExpense: round2(uncategorizedExpense),
  };
}

export type MonthPoint = { month: string; income: number; expense: number; net: number };

export async function monthlyCashflow(from: string, to: string): Promise<MonthPoint[]> {
  const rows = await txInRange(from, to);
  const map = new Map<string, MonthPoint>();
  for (const t of rows) {
    const month = (t.bookedDate || "").slice(0, 7);
    if (!month) continue;
    const cur = map.get(month) ?? { month, income: 0, expense: 0, net: 0 };
    if (t.amount >= 0) cur.income = round2(cur.income + t.amount);
    else cur.expense = round2(cur.expense + Math.abs(t.amount));
    cur.net = round2(cur.income - cur.expense);
    map.set(month, cur);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export type DashboardStats = {
  cashIn: number;
  cashOut: number;
  net: number;
  latestBalance: number | null;
  txCount: number;
  uncategorized: number;
  outstandingInvoices: number;
  outstandingAmount: number;
  overdueAmount: number;
  paidThisPeriod: number;
  monthly: MonthPoint[];
  topExpenses: CategoryLine[];
};

export async function dashboardStats(from: string, to: string): Promise<DashboardStats> {
  const tid = tenantId();
  const rows = await txInRange(from, to);
  let cashIn = 0;
  let cashOut = 0;
  let uncategorized = 0;
  for (const t of rows) {
    if (t.amount >= 0) cashIn += t.amount;
    else cashOut += Math.abs(t.amount);
    if (!t.categoryId) uncategorized += 1;
  }
  // Latest balance overall (not range-bound). Bank balance is the bank's own
  // figure, so an excluded line still moved the money and still counts here.
  //
  // Done in SQL rather than by loading every transaction and sorting in JS: on a
  // local SQLite file that was free, but it is a full table transfer over the
  // wire against Neon just to read one number.
  const [latest, invs] = await Promise.all([
    db
      .select({ balance: transactions.balance, d: transactions.bookedDate })
      .from(transactions)
      .where(and(eq(transactions.tenantId, tid), isNotNull(transactions.balance)))
      .orderBy(desc(transactions.bookedDate))
      .limit(1)
      .then(first),
    db.select().from(invoices).where(eq(invoices.tenantId, tid)),
  ]);
  const today = to;
  let outstandingInvoices = 0;
  let outstandingAmount = 0;
  let overdueAmount = 0;
  let paidThisPeriod = 0;
  for (const inv of invs) {
    if (inv.status === "void" || inv.status === "draft") continue;
    const due = round2(inv.total - inv.amountPaid);
    if (due > 0.005) {
      outstandingInvoices += 1;
      outstandingAmount += due;
      if (inv.dueDate && inv.dueDate < today) overdueAmount += due;
    }
  }
  const [pnl, monthly] = await Promise.all([
    profitAndLoss(from, to),
    monthlyCashflow(from, to),
  ]);

  return {
    cashIn: round2(cashIn),
    cashOut: round2(cashOut),
    net: round2(cashIn - cashOut),
    latestBalance: latest?.balance ?? null,
    txCount: rows.length,
    uncategorized,
    outstandingInvoices,
    outstandingAmount: round2(outstandingAmount),
    overdueAmount: round2(overdueAmount),
    paidThisPeriod: round2(paidThisPeriod),
    monthly,
    topExpenses: pnl.expenses.slice(0, 6),
  };
}
