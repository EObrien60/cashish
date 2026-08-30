import { db, first, schema, tenantId } from "@cashish/core/db";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  ilike,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
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

/** Scopes every transaction query to the calling tenant. */
const ofTenant = () => eq(transactions.tenantId, tenantId());

// The dedupe contract: a row whose provider id already exists is left exactly
// as-is (we never clobber user categorisation on re-import). Only genuinely new
// transactions are written. This is what lets you upload overlapping statements.
//
// Dedupe is per tenant — the primary key is (tenant_id, id) because a provider
// transaction id is unique to the provider, not to this database.
export async function importTransactions(
  rows: ParsedRow[],
  parseErrors: string[],
): Promise<ImportSummary> {
  const batch = uid();
  const tid = tenantId();
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
    (
      await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(ofTenant(), inArray(transactions.id, ids)))
    ).map((r) => r.id),
  );

  const fresh = rows.filter((r) => !existing.has(r.id));
  const duplicates = rows.length - fresh.length;

  let autoCategorized = 0;
  if (fresh.length > 0) {
    const insertRows = fresh.map((r) => ({ ...r, tenantId: tid, importBatch: batch }));
    // Chunked to stay under Postgres' 65535 bind-parameter ceiling; each row is
    // ~25 parameters, so 200 rows is comfortably inside it.
    const CHUNK = 200;
    await db.transaction(async (trx) => {
      for (let i = 0; i < insertRows.length; i += CHUNK) {
        await trx.insert(transactions).values(insertRows.slice(i, i + CHUNK));
      }
    });
    // Auto-categorise the freshly imported transactions using saved rules.
    const freshRows = await db
      .select()
      .from(transactions)
      .where(and(ofTenant(), eq(transactions.importBatch, batch)));
    autoCategorized = (await applyRulesToTransactions(freshRows)).updated;
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

export async function listTransactions(filter: TxFilter = {}) {
  const conds: SQL[] = [ofTenant()];
  // Default is hide: a caller that says nothing must never be handed excluded rows.
  const excluded = filter.excluded ?? "hide";
  if (excluded === "hide") conds.push(eq(transactions.excluded, false));
  if (excluded === "only") conds.push(eq(transactions.excluded, true));
  if (filter.from) conds.push(gte(transactions.bookedDate, filter.from));
  if (filter.to) conds.push(lte(transactions.bookedDate, filter.to));
  if (filter.direction === "in") conds.push(gte(transactions.amount, 0));
  if (filter.direction === "out") conds.push(lte(transactions.amount, 0));
  if (filter.uncategorized) conds.push(isNull(transactions.categoryId));
  if (filter.categoryId === "none") {
    conds.push(isNull(transactions.categoryId));
  } else if (filter.categoryId) {
    conds.push(eq(transactions.categoryId, filter.categoryId));
  }
  if (filter.search) {
    const q = `%${filter.search}%`;
    // ilike: Postgres LIKE is case-sensitive, SQLite's was not.
    conds.push(
      or(
        ilike(transactions.description, q),
        ilike(transactions.reference, q),
        ilike(transactions.payer, q),
      )!,
    );
  }

  return db
    .select()
    .from(transactions)
    .where(and(...conds))
    .orderBy(desc(transactions.bookedDate), desc(transactions.createdAt));
}

export async function updateTransaction(
  id: string,
  patch: Partial<{
    categoryId: string | null;
    vatRateId: string | null;
    note: string;
    reconciled: boolean;
  }>,
) {
  await db
    .update(transactions)
    .set(patch)
    .where(and(ofTenant(), eq(transactions.id, id)));
  return first(
    await db
      .select()
      .from(transactions)
      .where(and(ofTenant(), eq(transactions.id, id)))
      .limit(1),
  );
}

// Bulk categorise — used by the "apply to all matching" affordance.
//
// Returns rows actually changed, not ids requested. Those differ whenever an id
// does not exist or belongs to another tenant, and reporting the request back as
// if it were the result told an MCP agent that work had happened when none had.
export async function bulkCategorize(ids: string[], categoryId: string | null) {
  if (ids.length === 0) return 0;
  const updated = await db
    .update(transactions)
    .set({ categoryId })
    .where(and(ofTenant(), inArray(transactions.id, ids)))
    .returning({ id: transactions.id });
  return updated.length;
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
export async function setExcluded(
  ids: string[],
  excluded: boolean,
  reason = "",
): Promise<{ updated: number }> {
  if (ids.length === 0) return { updated: 0 };
  // As with bulkCategorize: the count is rows changed, not ids asked about.
  const updated = await db
    .update(transactions)
    .set({
      excluded,
      // Clearing the flag clears the reason with it, rather than leaving a stale one behind.
      excludedReason: excluded ? reason : "",
      // An excluded transaction cannot also be categorised — it is out of the books.
      ...(excluded ? { categoryId: null, vatRateId: null } : {}),
    })
    .where(and(ofTenant(), inArray(transactions.id, ids)))
    .returning({ id: transactions.id });
  return { updated: updated.length };
}

/** Counts for the tab labels, so the UI does not have to fetch rows to show a number. */
export async function transactionCounts(): Promise<{
  included: number;
  excluded: number;
  uncategorised: number;
}> {
  const count = async (where: SQL | undefined) =>
    Number(
      first(
        await db
          .select({ n: sql<number>`count(*)` })
          .from(transactions)
          .where(where)
          .limit(1),
      )?.n ?? 0,
    );
  return {
    included: await count(and(ofTenant(), eq(transactions.excluded, false))),
    excluded: await count(and(ofTenant(), eq(transactions.excluded, true))),
    uncategorised: await count(
      and(ofTenant(), eq(transactions.excluded, false), isNull(transactions.categoryId)),
    ),
  };
}
