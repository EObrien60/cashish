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
import { ensureAccount, nameFromStatement } from "./accounts";
import { detectTransfers, pairTransfers } from "./transfers";

const { transactions } = schema;

export type ImportSummary = {
  batch: string;
  parsed: number;
  inserted: number;
  duplicates: number;
  autoCategorized: number;
  errors: string[];
  /** Accounts the statement turned out to cover, and which of them were new. */
  accounts?: { name: string; created: boolean; rows: number }[];
  /** Internal transfers recognised, and accounts inferred from their far side. */
  transfers?: { detected: number; paired: number; accountsCreated: string[] };
};

/** Scopes every transaction query to the calling tenant. */
const ofTenant = () => eq(transactions.tenantId, tenantId());

// The dedupe contract: a row whose provider id already exists is left exactly
// as-is (we never clobber user categorisation on re-import). Only genuinely new
// transactions are written. This is what lets you upload overlapping statements.
//
// Dedupe is per tenant — the primary key is (tenant_id, id) because a provider
// transaction id is unique to the provider, not to this database.
/**
 * Imports a statement.
 *
 * `fallbackAccount` is the account to use for rows whose statement did not name
 * one. A Revolut export always does — `Product` on a personal one, `Account` on
 * a business one — but a file from anywhere else may not, and a transaction on
 * no account at all is a transaction that can never be reconciled against a
 * bank balance.
 */
export async function importTransactions(
  rows: ParsedRow[],
  parseErrors: string[],
  options: { fallbackAccount?: string } = {},
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

  // Which account each row sat on. The statement names it; where it does not,
  // everything lands on one account rather than on none.
  const accountSummary = new Map<string, { name: string; created: boolean; rows: number }>();
  const accountIdFor = new Map<string, string>();
  for (const r of fresh) {
    const raw = (r.account ?? "").trim();
    const name = nameFromStatement(raw, options.fallbackAccount ?? "Main");
    if (!accountIdFor.has(name)) {
      const { id, created } = await ensureAccount({
        name,
        externalRef: raw || name,
        currency: r.currency ?? "EUR",
        inferred: false,
      });
      accountIdFor.set(name, id);
      accountSummary.set(name, { name, created, rows: 0 });
    }
    accountSummary.get(name)!.rows += 1;
  }

  let autoCategorized = 0;
  if (fresh.length > 0) {
    const insertRows = fresh.map((r) => ({
      ...r,
      tenantId: tid,
      importBatch: batch,
      accountId:
        accountIdFor.get(nameFromStatement((r.account ?? "").trim(), options.fallbackAccount ?? "Main")) ??
        null,
    }));
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

  // Transfers are recognised on the way in, so money moved between your own
  // accounts never spends a moment counted as expenditure. Pairing then runs
  // over the whole ledger, because the other half of a transfer imported today
  // may have arrived in a file three weeks ago.
  const detected = await detectTransfers({ batch });
  const paired = await pairTransfers();

  return {
    batch,
    parsed: rows.length,
    inserted: fresh.length,
    duplicates,
    autoCategorized,
    errors: parseErrors,
    accounts: [...accountSummary.values()],
    transfers: {
      detected: detected.detected,
      paired,
      accountsCreated: detected.accountsCreated,
    },
  };
}

/**
 * Excluded transactions are counted nowhere: not in reports, not in VAT, not in
 * reconciliation, not in what Lunar is told. Every query over transactions that feeds a
 * number uses this, so the rule lives in one place rather than being remembered five times.
 */
export const notExcluded = () => eq(transactions.excluded, false);

/**
 * Not your own money changing pockets.
 *
 * A recognised transfer is neither income nor spending, and any total that
 * includes one is wrong twice over — the sending account looks like it spent
 * the money and the receiving one like it earned it. `notExcluded` does NOT
 * cover this: detection sets transferAccountId, whereas excluding is a separate
 * decision that only happens if somebody writes a transfer rule.
 *
 * Used beside notExcluded() wherever money is added up.
 */
export const notTransfer = () => sql`${transactions.transferAccountId} is null`;

export type TxFilter = {
  from?: string;
  to?: string;
  search?: string;
  categoryId?: string | "none";
  direction?: "in" | "out";
  uncategorized?: boolean;
  /** One account's ledger, rather than the whole book's. */
  accountId?: string;
  /**
   * Excluded transactions are hidden everywhere by default — that is the point of
   * excluding them. "only" is the excluded tab; "all" is for reconciling against a
   * statement, where every line has to be accounted for.
   */
  excluded?: "hide" | "only" | "all";
  /**
   * Rows to return, newest first. The ledger page is the reason this exists: a
   * three-year personal statement is ten thousand rows, and serialising all of
   * them into a page costs several megabytes before anybody has looked at one.
   */
  limit?: number;
};

function conditionsFor(filter: TxFilter): SQL[] {
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
  if (filter.accountId) conds.push(eq(transactions.accountId, filter.accountId));
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

  return conds;
}

export async function listTransactions(filter: TxFilter = {}) {
  const query = db
    .select()
    .from(transactions)
    .where(and(...conditionsFor(filter)))
    .orderBy(desc(transactions.bookedDate), desc(transactions.createdAt));

  return filter.limit ? query.limit(filter.limit) : query;
}

/**
 * Count and totals for a filter, over ALL of it rather than a page of it.
 *
 * Once the ledger stopped loading every row, a footer that added up what had
 * been loaded would quietly report the wrong total for anyone with more
 * transactions than fit on a page — a number that looks authoritative and is
 * not. This does the arithmetic in Postgres, where the whole set is.
 */
export async function summariseTransactions(
  filter: TxFilter = {},
): Promise<{ count: number; inSum: number; outSum: number }> {
  const row = first(
    await db
      .select({
        count: sql<number>`count(*)`,
        inSum: sql<number>`coalesce(sum(case when ${transactions.amount} >= 0 then ${transactions.amount} else 0 end), 0)`,
        outSum: sql<number>`coalesce(sum(case when ${transactions.amount} < 0 then -${transactions.amount} else 0 end), 0)`,
      })
      .from(transactions)
      .where(and(...conditionsFor({ ...filter, limit: undefined })))
      .limit(1),
  );
  return {
    count: Number(row?.count ?? 0),
    inSum: Number(row?.inSum ?? 0),
    outSum: Number(row?.outSum ?? 0),
  };
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
