import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db, first, schema, tenantId } from "@cashish/core/db";
import { notExcluded } from "./transactions";

const { categories, vatRates, products, settings, transactions, rpns } = schema;

// ---------------------------------------------------------------------------
// Reference reads for the view layer.
//
// These exist so no page constructs a query of its own. Pages were reaching for
// `db` directly, which is precisely where a missing tenant filter would never
// be noticed — a settings page that renders *someone else's* business name does
// not look like a bug until it is a very bad one. Every read below is scoped,
// once, here.
// ---------------------------------------------------------------------------

export async function listCategories() {
  return db
    .select()
    .from(categories)
    .where(eq(categories.tenantId, tenantId()))
    .orderBy(asc(categories.kind), asc(categories.name));
}

export async function listVatRates() {
  return db
    .select()
    .from(vatRates)
    .where(eq(vatRates.tenantId, tenantId()))
    .orderBy(asc(vatRates.sortOrder));
}

export async function listProducts(options: { includeArchived?: boolean } = {}) {
  const conds = [eq(products.tenantId, tenantId())];
  if (!options.includeArchived) conds.push(eq(products.archived, false));
  return db
    .select()
    .from(products)
    .where(and(...conds))
    .orderBy(asc(products.name));
}

/**
 * The tenant's settings row.
 *
 * Non-null by construction: createTenant() writes it in the same transaction
 * that creates the tenant, so a tenant without settings cannot exist.
 */
export async function getSettings() {
  const row = first(
    await db.select().from(settings).where(eq(settings.tenantId, tenantId())).limit(1),
  );
  if (!row) throw new Error(`tenant ${tenantId()} has no settings row`);
  return row;
}

/** The whole ledger, newest first — what the transactions table renders. */
export async function listAllTransactions() {
  return db
    .select()
    .from(transactions)
    .where(eq(transactions.tenantId, tenantId()))
    .orderBy(desc(transactions.bookedDate), desc(transactions.createdAt));
}

export async function uncategorisedCount(): Promise<number> {
  const rows = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(eq(transactions.tenantId, tenantId()), isNull(transactions.categoryId), notExcluded()),
    );
  return rows.length;
}

export async function listRpns(taxYear: number) {
  return db
    .select()
    .from(rpns)
    .where(and(eq(rpns.tenantId, tenantId()), eq(rpns.taxYear, taxYear)))
    .orderBy(desc(rpns.createdAt));
}

// ---------------------------------------------------------------------------
// The one read here that is deliberately NOT tenant-scoped.
//
// Plans are a property of the deployment, not of a business, and the pricing
// page is served to visitors who have no tenant at all. Reading `plans` from
// the table rather than from a constant is what stops the site advertising a
// limit that src/lib/limits.ts does not enforce — both read this row.
// ---------------------------------------------------------------------------

export async function publicPlans() {
  const rows = await db
    .select()
    .from(schema.plans)
    .where(eq(schema.plans.isActive, true))
    .orderBy(asc(schema.plans.sortOrder));
  return rows;
}
