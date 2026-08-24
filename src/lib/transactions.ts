import { db, schema } from "@/db/client";
import { and, desc, eq, gte, inArray, lte, like, or, sql, type SQL } from "drizzle-orm";
import { uid } from "./id";
import type { ParsedRow } from "./import";
import { applyRulesToTransactions } from "./rules";

const { transactions } = schema;

export type ImportSummary = {
  batch: string;
  parsed: number;
  inserted: number;
  duplicates: number;
  autoCategorized: number;
  errors: string[];
};

// The dedupe contract: a row whose provider id already exists is left exactly
// as-is (we never clobber user categorisation on re-import). Only genuinely new
// transactions are written. This is what lets you upload overlapping statements.
export function importTransactions(
  rows: ParsedRow[],
  parseErrors: string[],
): ImportSummary {
  const batch = uid();
  if (rows.length === 0) {
    return {
      batch,
      parsed: 0,
      inserted: 0,
      duplicates: 0,
      autoCategorized: 0,
      errors: parseErrors,
    };
  }

  const ids = rows.map((r) => r.id);
  const existing = new Set(
    db
      .select({ id: transactions.id })
      .from(transactions)
      .where(inArray(transactions.id, ids))
      .all()
      .map((r) => r.id),
  );

  const fresh = rows.filter((r) => !existing.has(r.id));
  const duplicates = rows.length - fresh.length;

  let autoCategorized = 0;
  if (fresh.length > 0) {
    const insertRows = fresh.map((r) => ({ ...r, importBatch: batch }));
    // chunk to stay well under SQLite's variable limit
    const CHUNK = 200;
    db.transaction((trx) => {
      for (let i = 0; i < insertRows.length; i += CHUNK) {
        trx.insert(transactions).values(insertRows.slice(i, i + CHUNK)).run();
      }
    });
    // Auto-categorise the freshly imported transactions using saved rules.
    const freshRows = db
      .select()
      .from(transactions)
      .where(eq(transactions.importBatch, batch))
      .all();
    autoCategorized = applyRulesToTransactions(freshRows).updated;
  }

  return {
    batch,
    parsed: rows.length,
    inserted: fresh.length,
    duplicates,
    autoCategorized,
    errors: parseErrors,
  };
}

/**
 * Excluded transactions are counted nowhere: not in reports, not in VAT, not in
 * reconciliation, not in what Lunar is told. Every query over transactions that feeds a
 * number uses this, so the rule lives in one place rather than being remembered five times.
 */
export const notExcluded = () => eq(transactions.excluded, false);

export type TxFilter = {
  from?: string;
  to?: string;
  search?: string;
  categoryId?: string | "none";
  direction?: "in" | "out";
  uncategorized?: boolean;
  /**
   * Excluded transactions are hidden everywhere by default — that is the point of
   * excluding them. "only" is the excluded tab; "all" is for reconciling against a
   * statement, where every line has to be accounted for.
   */
  excluded?: "hide" | "only" | "all";
};

export function listTransactions(filter: TxFilter = {}) {
  const conds = [];
  // Default is hide: a caller that says nothing must never be handed excluded rows.
  const excluded = filter.excluded ?? "hide";
  if (excluded === "hide") conds.push(eq(transactions.excluded, false));
  if (excluded === "only") conds.push(eq(transactions.excluded, true));
  if (filter.from) conds.push(gte(transactions.bookedDate, filter.from));
  if (filter.to) conds.push(lte(transactions.bookedDate, filter.to));
  if (filter.direction === "in") conds.push(gte(transactions.amount, 0));
  if (filter.direction === "out") conds.push(lte(transactions.amount, 0));
  if (filter.uncategorized) conds.push(sql`${transactions.categoryId} IS NULL`);
  if (filter.categoryId === "none") {
    conds.push(sql`${transactions.categoryId} IS NULL`);
  } else if (filter.categoryId) {
    conds.push(eq(transactions.categoryId, filter.categoryId));
  }
  if (filter.search) {
    const q = `%${filter.search}%`;
    conds.push(
      or(
        like(transactions.description, q),
        like(transactions.reference, q),
        like(transactions.payer, q),
      ),
    );
  }

  return db
    .select()
    .from(transactions)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(transactions.bookedDate), desc(transactions.createdAt))
    .all();
}

export function updateTransaction(
  id: string,
  patch: Partial<{
    categoryId: string | null;
    vatRateId: string | null;
    note: string;
    reconciled: boolean;
  }>,
) {
  db.update(transactions).set(patch).where(eq(transactions.id, id)).run();
  return db.select().from(transactions).where(eq(transactions.id, id)).get();
}

// Bulk categorise — used by the "apply to all matching" affordance.
export function bulkCategorize(ids: string[], categoryId: string | null) {
  if (ids.length === 0) return 0;
  db.update(transactions)
    .set({ categoryId })
    .where(inArray(transactions.id, ids))
    .run();
  return ids.length;
}

/**
 * Takes transactions out of the books, or puts them back.
 *
 * Excluding is not deleting: the row stays, so a statement still reconciles line for line
 * and the decision can be reversed. It simply stops being counted — reports, VAT,
 * reconciliation and what Lunar is told all skip it.
 *
 * The reason is worth recording. "Why is this €11,880 not in the accounts?" is a question
 * someone will ask, possibly an accountant, possibly you in a year.
 */
export function setExcluded(
  ids: string[],
  excluded: boolean,
  reason = "",
): { updated: number } {
  if (ids.length === 0) return { updated: 0 };
  db.update(transactions)
    .set({
      excluded,
      // Clearing the flag clears the reason with it, rather than leaving a stale one behind.
      excludedReason: excluded ? reason : "",
      // An excluded transaction cannot also be categorised — it is out of the books.
      ...(excluded ? { categoryId: null, vatRateId: null } : {}),
    })
    .where(inArray(transactions.id, ids))
    .run();
  return { updated: ids.length };
}

/** Counts for the tab labels, so the UI does not have to fetch rows to show a number. */
export function transactionCounts(): { included: number; excluded: number; uncategorised: number } {
  const count = (where: SQL | undefined) =>
    db.select({ n: sql<number>`count(*)` }).from(transactions).where(where).get()?.n ?? 0;
  return {
    included: count(eq(transactions.excluded, false)),
    excluded: count(eq(transactions.excluded, true)),
    uncategorised: count(and(eq(transactions.excluded, false), sql`${transactions.categoryId} IS NULL`)),
  };
}
