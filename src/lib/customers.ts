import { and, asc, eq, like, or } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { uid } from "./id";

const { customers } = schema;

// Customer reads and writes as plain functions, so both the UI's server actions
// and the MCP server can use them. The actions layer adds revalidatePath on top;
// nothing here knows about Next.

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

export function listCustomers(options: { includeArchived?: boolean; search?: string } = {}) {
  const conds = [];
  if (!options.includeArchived) conds.push(eq(customers.archived, false));
  if (options.search) {
    const q = `%${options.search}%`;
    conds.push(or(like(customers.name, q), like(customers.email, q)));
  }
  return db
    .select()
    .from(customers)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(customers.name))
    .all();
}

export function getCustomer(id: string) {
  return db.select().from(customers).where(eq(customers.id, id)).get() ?? null;
}

/** Case-insensitive exact name lookup, so repeated imports do not create duplicates. */
export function findCustomerByName(name: string) {
  const needle = name.trim().toLowerCase();
  return listCustomers({ includeArchived: true }).find((c) => c.name.trim().toLowerCase() === needle) ?? null;
}

export function createCustomer(input: CustomerInput) {
  const existing = findCustomerByName(input.name);
  if (existing) return { customer: existing, created: false };
  const id = uid();
  db.insert(customers)
    .values({
      id,
      name: input.name.trim(),
      email: input.email ?? "",
      vatNumber: input.vatNumber ?? "",
      addressLine1: input.addressLine1 ?? "",
      addressLine2: input.addressLine2 ?? "",
      city: input.city ?? "",
      country: input.country ?? "Ireland",
      notes: input.notes ?? "",
    })
    .run();
  return { customer: getCustomer(id)!, created: true };
}

export function updateCustomer(id: string, input: Partial<CustomerInput>) {
  const patch = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
  if (Object.keys(patch).length) {
    db.update(customers).set(patch).where(eq(customers.id, id)).run();
  }
  return getCustomer(id);
}

export function setCustomerArchived(id: string, archived: boolean) {
  db.update(customers).set({ archived }).where(eq(customers.id, id)).run();
  return getCustomer(id);
}
