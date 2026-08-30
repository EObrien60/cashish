import { sql, eq, desc } from "drizzle-orm";
import { db, schema } from "@cashish/core/db";

// Cross-tenant reads of people. Same rule as queries/tenants.ts: `db` directly,
// outside any tenant context, and nothing from apps/books.

const { users, memberships, tenants, apiKeys } = schema;

export type UserRow = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  disabledAt: string | null;
  membershipCount: number;
};

export async function listUsers(search?: string): Promise<UserRow[]> {
  const term = search?.trim().toLowerCase();

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      createdAt: users.createdAt,
      disabledAt: users.disabledAt,
      membershipCount: sql<number>`(select count(*)::int from ${memberships} m where m.user_id = ${users.id})`,
    })
    .from(users)
    .orderBy(desc(users.createdAt));

  if (!term) return rows;
  return rows.filter(
    (row) => row.email.toLowerCase().includes(term) || row.name.toLowerCase().includes(term),
  );
}

export type UserDetail = {
  user: { id: string; email: string; name: string; createdAt: string; disabledAt: string | null };
  memberships: { tenantId: string; slug: string; tenantName: string; role: string; joinedAt: string }[];
  keys: { id: string; name: string; prefix: string; role: string; tenantSlug: string; revokedAt: string | null }[];
};

export async function getUser(id: string): Promise<UserDetail | null> {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) return null;

  const rows = await db
    .select({
      tenantId: memberships.tenantId,
      slug: tenants.slug,
      tenantName: tenants.name,
      role: memberships.role,
      joinedAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(eq(memberships.userId, id));

  const keys = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      role: apiKeys.role,
      tenantSlug: tenants.slug,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .innerJoin(tenants, eq(tenants.id, apiKeys.tenantId))
    .where(eq(apiKeys.createdBy, id));

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      disabledAt: user.disabledAt,
    },
    memberships: rows,
    keys,
  };
}
