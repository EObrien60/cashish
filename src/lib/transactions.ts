import { db, schema } from "@/db/client";
import { and, desc, eq, gte, inArray, lte, like, or, sql } from "drizzle-orm";
import { uid } from "./id";
import type { ParsedRow } from "./import";

const { transactions } = schema;

export type ImportSummary = {
  batch: string;
  parsed: number;
  inserted: number;
  duplicates: number;
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

  if (fresh.length > 0) {
    const insertRows = fresh.map((r) => ({ ...r, importBatch: batch }));
    // chunk to stay well under SQLite's variable limit
    const CHUNK = 200;
    const tx = db.transaction((trx) => {
      for (let i = 0; i < insertRows.length; i += CHUNK) {
        trx.insert(transactions).values(insertRows.slice(i, i + CHUNK)).run();
      }
    });
    tx;
  }

  return {
    batch,
    parsed: rows.length,
    inserted: fresh.length,
    duplicates,
    errors: parseErrors,
  };
}

export type TxFilter = {
  from?: string;
  to?: string;
  search?: string;
  categoryId?: string | "none";
  direction?: "in" | "out";
  uncategorized?: boolean;
};

export function listTransactions(filter: TxFilter = {}) {
  const conds = [];
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
