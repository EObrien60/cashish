import { and, eq, gte, lte } from "drizzle-orm";
import { db, schema, tenantId } from "@cashish/core/db";
import { round2 } from "./format";
import { notExcluded } from "./transactions";
import { uid } from "./id";

const { budgets, categories, transactions } = schema;

// ---------------------------------------------------------------------------
// Budget versus actual, by category, by month.
//
// The whole of the envelope idea, and the only thing a personal book needs that
// the business one does not: what you meant to spend, next to what the bank
// says you did.
//
// The actual is never stored. It is the same ledger the business books read,
// summed by category over the month, so a budget cannot drift from the
// transactions it is judged against — there is one number and it is derived.
// ---------------------------------------------------------------------------

export type BudgetLine = {
  categoryId: string;
  name: string;
  kind: "income" | "expense";
  color: string;
  /** What was budgeted. Always positive; direction comes from `kind`. */
  budget: number;
  /** What the ledger says, as a positive magnitude. */
  actual: number;
  /**
   * Budget minus actual for spending, actual minus budget for income — so a
   * positive number is always the good direction and a colour can be dumb.
   */
  remaining: number;
  /** actual / budget, or null when nothing was budgeted. */
  usedPct: number | null;
};

export type MonthBudget = {
  month: string;
  income: BudgetLine[];
  expenses: BudgetLine[];
  totals: {
    budgetedIncome: number;
    actualIncome: number;
    budgetedExpense: number;
    actualExpense: number;
    /** Budgeted income less budgeted spending: the plan. */
    plannedNet: number;
    /** What actually happened. */
    actualNet: number;
    /** Spending with no budget line at all — the hole in the plan. */
    unbudgetedSpend: number;
  };
};

const monthBounds = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from, to };
};

export const currentMonth = (todayISO: string) => todayISO.slice(0, 7);

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

export async function budgetForMonth(month: string): Promise<MonthBudget> {
  const tid = tenantId();
  const { from, to } = monthBounds(month);

  const [cats, rows, txRows] = await Promise.all([
    db.select().from(categories).where(eq(categories.tenantId, tid)),
    db.select().from(budgets).where(and(eq(budgets.tenantId, tid), eq(budgets.month, month))),
    db
      .select({ categoryId: transactions.categoryId, amount: transactions.amount })
      .from(transactions)
      .where(
        and(
          eq(transactions.tenantId, tid),
          gte(transactions.bookedDate, from),
          lte(transactions.bookedDate, to),
          notExcluded(),
        ),
      ),
  ]);

  const budgeted = new Map(rows.map((r) => [r.categoryId, r.amount]));
  const actual = new Map<string, number>();
  let unbudgetedSpend = 0;

  for (const t of txRows) {
    if (!t.categoryId) {
      // Uncategorised money out is spending you have not accounted for, which
      // is exactly what a budget is meant to surface rather than quietly drop.
      if (t.amount < 0) unbudgetedSpend = round2(unbudgetedSpend + Math.abs(t.amount));
      continue;
    }
    actual.set(t.categoryId, round2((actual.get(t.categoryId) ?? 0) + Math.abs(t.amount)));
  }

  const lines: BudgetLine[] = cats
    .map((c) => {
      const budget = round2(budgeted.get(c.id) ?? 0);
      const spent = round2(actual.get(c.id) ?? 0);
      const kind = c.kind === "income" ? ("income" as const) : ("expense" as const);
      return {
        categoryId: c.id,
        name: c.name,
        kind,
        color: c.color ?? "#9ca3af",
        budget,
        actual: spent,
        remaining: round2(kind === "income" ? spent - budget : budget - spent),
        usedPct: budget > 0 ? round2((spent / budget) * 100) : null,
      };
    })
    // A category with neither a budget nor any activity is noise this month.
    .filter((l) => l.budget !== 0 || l.actual !== 0);

  const income = lines.filter((l) => l.kind === "income");
  const expenses = lines
    .filter((l) => l.kind === "expense")
    .sort((a, b) => b.actual - a.actual || b.budget - a.budget);

  const sum = (ls: BudgetLine[], f: (l: BudgetLine) => number) =>
    round2(ls.reduce((acc, l) => acc + f(l), 0));

  const budgetedIncome = sum(income, (l) => l.budget);
  const actualIncome = sum(income, (l) => l.actual);
  const budgetedExpense = sum(expenses, (l) => l.budget);
  const actualExpense = sum(expenses, (l) => l.actual);

  return {
    month,
    income,
    expenses,
    totals: {
      budgetedIncome,
      actualIncome,
      budgetedExpense,
      actualExpense,
      plannedNet: round2(budgetedIncome - budgetedExpense),
      actualNet: round2(actualIncome - actualExpense),
      unbudgetedSpend,
    },
  };
}

/** Sets one category's budget for one month. Zero deletes it. */
export async function setBudget(input: { categoryId: string; month: string; amount: number }) {
  const tid = tenantId();
  const amount = round2(Math.abs(input.amount));

  if (amount === 0) {
    await db
      .delete(budgets)
      .where(
        and(
          eq(budgets.tenantId, tid),
          eq(budgets.categoryId, input.categoryId),
          eq(budgets.month, input.month),
        ),
      );
    return;
  }

  await db
    .insert(budgets)
    .values({ id: uid(), tenantId: tid, categoryId: input.categoryId, month: input.month, amount })
    // The unique index is what makes this an upsert rather than a race between
    // two tabs both deciding the row does not exist yet.
    .onConflictDoUpdate({
      target: [budgets.tenantId, budgets.categoryId, budgets.month],
      set: { amount },
    });
}

/**
 * Copies a month's budget onto another month.
 *
 * The single most-used action in a budgeting app: next month looks like this
 * one. Existing rows in the target are overwritten; categories absent from the
 * source are left alone rather than zeroed, so copying forward twice is safe.
 */
export async function copyBudget(from: string, to: string): Promise<number> {
  const tid = tenantId();
  const source = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.tenantId, tid), eq(budgets.month, from)));
  if (source.length === 0) return 0;

  await db
    .insert(budgets)
    .values(
      source.map((r) => ({
        id: uid(),
        tenantId: tid,
        categoryId: r.categoryId,
        month: to,
        amount: r.amount,
      })),
    )
    .onConflictDoUpdate({
      target: [budgets.tenantId, budgets.categoryId, budgets.month],
      set: { amount: schema.budgets.amount },
    });
  return source.length;
}

/**
 * Seeds a month's budget from what was actually spent over the last N months.
 *
 * The cold-start problem: an empty budget page asks a person to invent fifteen
 * numbers before it shows them anything. The median of recent months is a
 * defensible first guess and, more to the point, an editable one.
 */
export async function suggestBudget(month: string, lookbackMonths = 3): Promise<number> {
  const tid = tenantId();
  const { from } = monthBounds(month);
  const start = new Date(from + "T00:00:00Z");
  const lookFrom = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - lookbackMonths, 1))
    .toISOString()
    .slice(0, 10);
  const lookTo = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 0))
    .toISOString()
    .slice(0, 10);

  const rows = await db
    .select({
      categoryId: transactions.categoryId,
      amount: transactions.amount,
      bookedDate: transactions.bookedDate,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tid),
        gte(transactions.bookedDate, lookFrom),
        lte(transactions.bookedDate, lookTo),
        notExcluded(),
      ),
    );

  // category -> month -> total
  const byCategory = new Map<string, Map<string, number>>();
  for (const t of rows) {
    if (!t.categoryId) continue;
    const perMonth = byCategory.get(t.categoryId) ?? new Map<string, number>();
    const key = t.bookedDate.slice(0, 7);
    perMonth.set(key, round2((perMonth.get(key) ?? 0) + Math.abs(t.amount)));
    byCategory.set(t.categoryId, perMonth);
  }

  let written = 0;
  for (const [categoryId, perMonth] of byCategory) {
    const totals = [...perMonth.values()].sort((a, b) => a - b);
    if (totals.length === 0) continue;
    const mid = Math.floor(totals.length / 2);
    const median =
      totals.length % 2 === 1 ? totals[mid] : round2((totals[mid - 1] + totals[mid]) / 2);
    if (round2(median) === 0) continue;
    await setBudget({ categoryId, month, amount: median });
    written += 1;
  }
  return written;
}
