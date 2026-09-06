import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db, schema, tenantId } from "@cashish/core/db";
import { round2 } from "./format";
import { notExcluded } from "./transactions";
import { accountBalances, groupAccounts } from "./accounts";

const { transactions, categories, accounts } = schema;

// ---------------------------------------------------------------------------
// The facts a report is written from.
//
// EVERY NUMBER IN A GENERATED REPORT COMES FROM HERE, computed in Postgres or
// in this file, and the model is given them as facts it may quote but never
// recompute. That is the whole design. A language model asked to add up a
// column will produce something plausible, and a plausible wrong total in a set
// of books is worse than no report at all — it is wrong in a way that reads as
// authoritative and survives being checked casually.
//
// So the split is: arithmetic here, judgement there. The model decides what is
// worth saying, which comparison matters, and what to warn about. It never
// decides what a number is.
// ---------------------------------------------------------------------------

export type MerchantSpend = {
  /** The folded label, e.g. "Circle K" for "Circle K Gas Station". */
  label: string;
  total: number;
  count: number;
  category: string | null;
  firstSeen: string;
  lastSeen: string;
  /** Present in at least half the months looked at. */
  recurring: boolean;
};

export type MonthTotals = {
  month: string;
  in: number;
  out: number;
  net: number;
};

export type CategorySpend = {
  category: string;
  kind: string;
  total: number;
  count: number;
  /** Change against the previous equivalent period, as a signed amount. */
  change: number | null;
};

export type FactSheet = {
  from: string;
  to: string;
  currency: string;
  bookKind: string;
  totals: {
    in: number;
    out: number;
    net: number;
    /** Excluded from the books: transfers between your own accounts, mostly. */
    movedBetweenAccounts: number;
    uncategorisedOut: number;
    uncategorisedCount: number;
  };
  months: MonthTotals[];
  categories: CategorySpend[];
  merchants: MerchantSpend[];
  accounts: {
    name: string;
    kind: string;
    currency: string;
    balance: number;
    held: number;
    owed: number;
  }[];
  /** Per currency: held, owed, net. Currencies are never summed together. */
  position: { currency: string; held: number; owed: number; net: number }[];
};

/**
 * Folds a bank description to the merchant behind it.
 *
 * "Circle K Gas Station" and "Circle K" are one merchant; "Insomnia Coffee
 * Company" appearing four times is one line, not four. Purely mechanical —
 * lowercase, drop card noise and trailing references, keep the first few
 * words. Anything cleverer than this is the model's job, not a regex's.
 */
export function merchantLabel(description: string): string {
  const cleaned = (description ?? "")
    .replace(/\b[0-9]{4,}\b/g, " ")
    .replace(/[*#]/g, " ")
    .replace(/\b(ltd|limited|inc|inc\.|llc|gmbh|bv|plc)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.split(" ").slice(0, 3).join(" ") || "Unnamed";
}

const monthOf = (iso: string) => iso.slice(0, 7);

function shiftPeriod(from: string, to: string): { from: string; to: string } {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  const span = b - a;
  return {
    from: new Date(a - span - 86_400_000).toISOString().slice(0, 10),
    to: new Date(a - 86_400_000).toISOString().slice(0, 10),
  };
}

export async function buildFactSheet(input: { from: string; to: string }): Promise<FactSheet> {
  const tid = tenantId();
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tid));

  const inRange = (from: string, to: string) =>
    and(
      eq(transactions.tenantId, tid),
      gte(transactions.bookedDate, from),
      lte(transactions.bookedDate, to),
    );

  const [rows, prior, cats, balances] = await Promise.all([
    db.select().from(transactions).where(and(inRange(input.from, input.to), notExcluded())),
    (async () => {
      const p = shiftPeriod(input.from, input.to);
      return db.select().from(transactions).where(and(inRange(p.from, p.to), notExcluded()));
    })(),
    db.select().from(categories).where(eq(categories.tenantId, tid)),
    accountBalances(),
  ]);

  // Transfers are excluded rows, so they are absent above — counted separately,
  // because "you moved €20,000 to savings" is worth saying and is not spending.
  const moved = await db
    .select({ total: sql<number>`coalesce(sum(abs(${transactions.amount})), 0)` })
    .from(transactions)
    .where(
      and(
        inRange(input.from, input.to),
        eq(transactions.excluded, true),
        sql`${transactions.transferAccountId} is not null`,
        sql`${transactions.amount} < 0`,
      ),
    );

  const catName = new Map(cats.map((c) => [c.id, c]));

  let totalIn = 0;
  let totalOut = 0;
  let uncategorisedOut = 0;
  let uncategorisedCount = 0;
  const byMonth = new Map<string, { in: number; out: number }>();
  const byCategory = new Map<string, { total: number; count: number; kind: string }>();
  const byMerchant = new Map<
    string,
    { total: number; count: number; category: string | null; months: Set<string>; first: string; last: string }
  >();

  for (const t of rows) {
    const m = monthOf(t.bookedDate);
    const bucket = byMonth.get(m) ?? { in: 0, out: 0 };
    if (t.amount >= 0) {
      totalIn += t.amount;
      bucket.in += t.amount;
    } else {
      totalOut += Math.abs(t.amount);
      bucket.out += Math.abs(t.amount);
    }
    byMonth.set(m, bucket);

    const cat = t.categoryId ? catName.get(t.categoryId) : null;
    if (!cat && t.amount < 0) {
      uncategorisedOut += Math.abs(t.amount);
      uncategorisedCount += 1;
    }
    const key = cat?.name ?? "Uncategorised";
    const c = byCategory.get(key) ?? { total: 0, count: 0, kind: cat?.kind ?? "expense" };
    c.total += Math.abs(t.amount);
    c.count += 1;
    byCategory.set(key, c);

    // Merchants are about spending; money in is customers and salary, which the
    // category breakdown already answers better.
    if (t.amount < 0) {
      const label = merchantLabel(t.description ?? "");
      const seen = byMerchant.get(label) ?? {
        total: 0,
        count: 0,
        category: cat?.name ?? null,
        months: new Set<string>(),
        first: t.bookedDate,
        last: t.bookedDate,
      };
      seen.total += Math.abs(t.amount);
      seen.count += 1;
      seen.months.add(m);
      if (t.bookedDate < seen.first) seen.first = t.bookedDate;
      if (t.bookedDate > seen.last) seen.last = t.bookedDate;
      if (!seen.category && cat) seen.category = cat.name;
      byMerchant.set(label, seen);
    }
  }

  // The same again for the period before, so a change can be stated rather than
  // implied. Only categories are compared: merchant-level noise is not signal.
  const priorByCategory = new Map<string, number>();
  for (const t of prior) {
    const cat = t.categoryId ? catName.get(t.categoryId) : null;
    const key = cat?.name ?? "Uncategorised";
    priorByCategory.set(key, (priorByCategory.get(key) ?? 0) + Math.abs(t.amount));
  }

  const monthCount = Math.max(1, byMonth.size);
  const groups = groupAccounts(balances);

  return {
    from: input.from,
    to: input.to,
    currency: tenant?.currency ?? "EUR",
    bookKind: tenant?.kind ?? "business",
    totals: {
      in: round2(totalIn),
      out: round2(totalOut),
      net: round2(totalIn - totalOut),
      movedBetweenAccounts: round2(Number(moved[0]?.total ?? 0)),
      uncategorisedOut: round2(uncategorisedOut),
      uncategorisedCount,
    },
    months: [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({
        month,
        in: round2(v.in),
        out: round2(v.out),
        net: round2(v.in - v.out),
      })),
    categories: [...byCategory.entries()]
      .map(([category, v]) => ({
        category,
        kind: v.kind,
        total: round2(v.total),
        count: v.count,
        change:
          priorByCategory.has(category)
            ? round2(v.total - (priorByCategory.get(category) ?? 0))
            : null,
      }))
      .sort((a, b) => b.total - a.total),
    merchants: [...byMerchant.entries()]
      .map(([label, v]) => ({
        label,
        total: round2(v.total),
        count: v.count,
        category: v.category,
        firstSeen: v.first,
        lastSeen: v.last,
        recurring: v.months.size >= Math.ceil(monthCount / 2) && v.months.size > 1,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 40),
    accounts: balances.map((b) => ({
      name: b.name,
      kind: b.kind,
      currency: b.currency,
      balance: b.balance,
      held: b.balance > 0 ? b.balance : 0,
      owed: b.balance < 0 ? -b.balance : 0,
    })),
    position: groups.map((g) => ({
      currency: g.currency,
      held: g.held,
      owed: g.owed,
      net: g.net,
    })),
  };
}

/**
 * Spending that no rule explains, grouped by merchant.
 *
 * The input to rule suggestion: what is uncategorised, how much of it there is,
 * and how often it recurs — so the model proposes rules for the things that
 * actually cost money rather than for a one-off coffee.
 */
export async function uncategorisedByMerchant(limit = 30): Promise<MerchantSpend[]> {
  const tid = tenantId();
  const rows = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.tenantId, tid), notExcluded(), sql`${transactions.categoryId} is null`));

  const byMerchant = new Map<string, { total: number; count: number; months: Set<string>; first: string; last: string }>();
  for (const t of rows) {
    const label = merchantLabel(t.description ?? "");
    const seen = byMerchant.get(label) ?? {
      total: 0,
      count: 0,
      months: new Set<string>(),
      first: t.bookedDate,
      last: t.bookedDate,
    };
    seen.total += Math.abs(t.amount);
    seen.count += 1;
    seen.months.add(monthOf(t.bookedDate));
    if (t.bookedDate < seen.first) seen.first = t.bookedDate;
    if (t.bookedDate > seen.last) seen.last = t.bookedDate;
    byMerchant.set(label, seen);
  }

  return [...byMerchant.entries()]
    .map(([label, v]) => ({
      label,
      total: round2(v.total),
      count: v.count,
      category: null,
      firstSeen: v.first,
      lastSeen: v.last,
      recurring: v.months.size > 1,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}
