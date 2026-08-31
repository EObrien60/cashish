import { sql, eq, desc } from "drizzle-orm";
import { db, schema } from "@cashish/core/db";

// ---------------------------------------------------------------------------
// Reads across every tenant.
//
// These run deliberately OUTSIDE runInTenant and query `db` directly, which is
// the exact opposite of the rule the books app lives by. That is the point: the
// console's job is the view across the whole deployment, and the tenant gate in
// @cashish/core/db exists to stop the books app doing this by accident, not to
// stop this application doing it on purpose.
//
// What must never happen is this file importing anything from apps/books —
// that is where tenant-scoped assumptions live, and mixing the two is how a
// query ends up scoped to a tenant that was never established. There is a test
// (tests/boundaries.test.ts) that fails if anyone tries.
//
// Note what is NOT selected anywhere here: no transaction, invoice, receipt or
// payslip row. Counts and dates answer a support question; a customer's ledger
// is not the console's business.
// ---------------------------------------------------------------------------

const { tenants, memberships, users, transactions, invoices, subscriptions, plans, settings, apiKeys, oauthTokens } =
  schema;

export type TenantRow = {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  memberCount: number;
  transactionCount: number;
  invoiceCount: number;
  lastActivity: string | null;
  planCode: string | null;
  status: string | null;
};

/**
 * The tenant list.
 *
 * Counts are correlated subqueries rather than joins: a join across members,
 * transactions and invoices multiplies the rows and then needs distinct counts
 * to undo the damage, which is both slower and easy to get subtly wrong.
 */
export async function listTenants(search?: string): Promise<TenantRow[]> {
  const term = search?.trim().toLowerCase();

  const rows = await db
    .select({
      id: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      createdAt: tenants.createdAt,
      memberCount: sql<number>`(select count(*)::int from ${memberships} m where m.tenant_id = ${tenants.id})`,
      transactionCount: sql<number>`(select count(*)::int from ${transactions} t where t.tenant_id = ${tenants.id})`,
      invoiceCount: sql<number>`(select count(*)::int from ${invoices} i where i.tenant_id = ${tenants.id})`,
      lastActivity: sql<string | null>`greatest(
        (select max(t.booked_date) from ${transactions} t where t.tenant_id = ${tenants.id}),
        (select max(i.issue_date) from ${invoices} i where i.tenant_id = ${tenants.id})
      )`,
      planCode: subscriptions.planCode,
      status: subscriptions.status,
    })
    .from(tenants)
    .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
    .orderBy(desc(tenants.createdAt));

  if (!term) return rows;
  return rows.filter(
    (row) =>
      row.slug.toLowerCase().includes(term) ||
      row.name.toLowerCase().includes(term) ||
      row.id === term,
  );
}

export type TenantMember = {
  userId: string;
  email: string;
  name: string;
  role: string;
  joinedAt: string;
  disabledAt: string | null;
};

export type TenantDetail = {
  tenant: { id: string; slug: string; name: string; createdAt: string };
  settings: { businessName: string; vatNumber: string | null; vatBasis: string; invoicePrefix: string } | null;
  members: TenantMember[];
  keys: { id: string; name: string; prefix: string; role: string; lastUsedAt: string | null; revokedAt: string | null }[];
  tokens: { tokenHash: string; clientId: string; kind: string; expiresAt: string; revokedAt: string | null }[];
  counts: { transactions: number; invoices: number; customers: number; members: number };
  subscription:
    | { id: string; planCode: string; status: string; trialEndsAt: string | null; currentPeriodEnd: string | null; note: string }
    | null;
};

export async function getTenant(id: string): Promise<TenantDetail | null> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  if (!tenant) return null;

  const [settingsRow] = await db.select().from(settings).where(eq(settings.tenantId, id)).limit(1);

  const members = await db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      role: memberships.role,
      joinedAt: memberships.createdAt,
      disabledAt: users.disabledAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.tenantId, id));

  const keys = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      role: apiKeys.role,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.tenantId, id));

  const tokens = await db
    .select({
      tokenHash: oauthTokens.tokenHash,
      clientId: oauthTokens.clientId,
      kind: oauthTokens.kind,
      expiresAt: oauthTokens.expiresAt,
      revokedAt: oauthTokens.revokedAt,
    })
    .from(oauthTokens)
    .where(eq(oauthTokens.tenantId, id));

  const [counts] = await db
    .select({
      transactions: sql<number>`(select count(*)::int from ${transactions} t where t.tenant_id = ${id})`,
      invoices: sql<number>`(select count(*)::int from ${invoices} i where i.tenant_id = ${id})`,
      customers: sql<number>`(select count(*)::int from ${schema.customers} c where c.tenant_id = ${id})`,
      members: sql<number>`(select count(*)::int from ${memberships} m where m.tenant_id = ${id})`,
    })
    .from(tenants)
    .where(eq(tenants.id, id));

  const [subscription] = await db
    .select({
      id: subscriptions.id,
      planCode: subscriptions.planCode,
      status: subscriptions.status,
      trialEndsAt: subscriptions.trialEndsAt,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      note: subscriptions.note,
    })
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, id))
    .limit(1);

  return {
    tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, createdAt: tenant.createdAt },
    settings: settingsRow
      ? {
          businessName: settingsRow.businessName,
          vatNumber: settingsRow.vatNumber,
          vatBasis: settingsRow.vatBasis,
          invoicePrefix: settingsRow.invoicePrefix,
        }
      : null,
    members,
    keys,
    tokens,
    counts,
    subscription: subscription ?? null,
  };
}

/** Row counts recorded in the audit entry when a tenant is deleted. */
export async function tenantFootprint(id: string) {
  const detail = await getTenant(id);
  if (!detail) return null;
  return {
    slug: detail.tenant.slug,
    name: detail.tenant.name,
    createdAt: detail.tenant.createdAt,
    ...detail.counts,
  };
}

export async function listPlans() {
  return db.select().from(plans).orderBy(plans.sortOrder);
}

export async function tenantsWithoutSubscription(): Promise<number> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(tenants)
    .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
    .where(sql`${subscriptions.id} is null`);
  return row?.count ?? 0;
}
