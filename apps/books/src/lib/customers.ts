import { and, asc, eq, ilike, or } from "drizzle-orm";
import { db, first, schema, tenantId } from "@cashish/core/db";
import { uid } from "./id";

const { customers } = schema;

// Customer reads and writes as plain functions, so both the UI's server actions
// and the MCP server can use them. The actions layer adds revalidatePath on top;
// nothing here knows about Next.
//
// Every query is scoped to the calling tenant via tenantId(), which throws if
// there is no tenant context — see context.ts in @cashish/core.

export type CustomerInput = {
  name: string;
  email?: string;
  vatNumber?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  country?: string;
  notes?: string;
};

export async function listCustomers(
  options: { includeArchived?: boolean; search?: string } = {},
) {
  const conds = [eq(customers.tenantId, tenantId())];
  if (!options.includeArchived) conds.push(eq(customers.archived, false));
  if (options.search) {
    const q = `%${options.search}%`;
    // ilike, not like: Postgres LIKE is case-sensitive where SQLite's was not,
    // so a plain port would have silently narrowed customer search.
    conds.push(or(ilike(customers.name, q), ilike(customers.email, q))!);
  }
  return db
    .select()
    .from(customers)
    .where(and(...conds))
    .orderBy(asc(customers.name));
}

export async function getCustomer(id: string) {
  return first(
    await db
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId()), eq(customers.id, id)))
      .limit(1),
  );
}

/** Case-insensitive exact name lookup, so repeated imports do not create duplicates. */
export async function findCustomerByName(name: string) {
  const needle = name.trim().toLowerCase();
  const all = await listCustomers({ includeArchived: true });
  return all.find((c) => c.name.trim().toLowerCase() === needle) ?? null;
}

export async function createCustomer(input: CustomerInput) {
  const existing = await findCustomerByName(input.name);
  if (existing) return { customer: existing, created: false };
  const id = uid();
  await db.insert(customers).values({
    id,
    tenantId: tenantId(),
    name: input.name.trim(),
    email: input.email ?? "",
    vatNumber: input.vatNumber ?? "",
    addressLine1: input.addressLine1 ?? "",
    addressLine2: input.addressLine2 ?? "",
    city: input.city ?? "",
    country: input.country ?? "Ireland",
    notes: input.notes ?? "",
  });
  return { customer: (await getCustomer(id))!, created: true };
}

export async function updateCustomer(id: string, input: Partial<CustomerInput>) {
  const patch = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
  if (Object.keys(patch).length) {
    await db
      .update(customers)
      .set(patch)
      .where(and(eq(customers.tenantId, tenantId()), eq(customers.id, id)));
  }
  return getCustomer(id);
}

export async function setCustomerArchived(id: string, archived: boolean) {
  await db
    .update(customers)
    .set({ archived })
    .where(and(eq(customers.tenantId, tenantId()), eq(customers.id, id)));
  return getCustomer(id);
}
