import { and, asc, desc, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db, first, schema, tenantId } from "@cashish/core/db";
import { uid } from "./id";
import { round2 } from "./format";
import { notExcluded } from "./transactions";

const { vendors, bills, billPayments, transactions, categories } = schema;

// ---------------------------------------------------------------------------
// Suppliers, and what you have spent with them.
//
// "Lifetime spend" is measured from BANK TRANSACTIONS attributed to the vendor,
// not from bills. Bills are what you were asked to pay; transactions are what
// actually left the account, and the two legitimately differ — a bill can sit
// unpaid for months. Both are reported, separately.
// ---------------------------------------------------------------------------

export type VendorInput = {
  name: string;
  email?: string;
  vatNumber?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  country?: string;
  defaultCategoryId?: string | null;
  notes?: string;
};

const ofTenant = () => eq(vendors.tenantId, tenantId());

export async function listVendors(options: { includeArchived?: boolean; search?: string } = {}) {
  const conds = [ofTenant()];
  if (!options.includeArchived) conds.push(eq(vendors.archived, false));
  if (options.search) {
    const q = `%${options.search}%`;
    conds.push(or(ilike(vendors.name, q), ilike(vendors.email, q))!);
  }
  return db
    .select()
    .from(vendors)
    .where(and(...conds))
    .orderBy(asc(vendors.name));
}

export async function getVendor(id: string) {
  return first(
    await db
      .select()
      .from(vendors)
      .where(and(ofTenant(), eq(vendors.id, id)))
      .limit(1),
  );
}

export async function findVendorByName(name: string) {
  const needle = name.trim().toLowerCase();
  const all = await listVendors({ includeArchived: true });
  return all.find((v) => v.name.trim().toLowerCase() === needle) ?? null;
}

export async function createVendor(input: VendorInput) {
  const existing = await findVendorByName(input.name);
  if (existing) return { vendor: existing, created: false };
  const id = uid();
  await db.insert(vendors).values({
    id,
    tenantId: tenantId(),
    name: input.name.trim(),
    email: input.email ?? "",
    vatNumber: input.vatNumber ?? "",
    addressLine1: input.addressLine1 ?? "",
    addressLine2: input.addressLine2 ?? "",
    city: input.city ?? "",
    country: input.country ?? "Ireland",
    defaultCategoryId: input.defaultCategoryId ?? null,
    notes: input.notes ?? "",
  });
  return { vendor: (await getVendor(id))!, created: true };
}

export async function updateVendor(id: string, input: Partial<VendorInput>) {
  const patch = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
  if (Object.keys(patch).length) {
    await db.update(vendors).set(patch).where(and(ofTenant(), eq(vendors.id, id)));
  }
  return getVendor(id);
}

export async function setVendorArchived(id: string, archived: boolean) {
  await db.update(vendors).set({ archived }).where(and(ofTenant(), eq(vendors.id, id)));
  return getVendor(id);
}

/** Spend and payable totals per vendor, for the list view. */
export async function vendorTotals() {
  const tid = tenantId();
  const [spendRows, billRows] = await Promise.all([
    db
      .select({
        vendorId: transactions.vendorId,
        spend: sql<string>`sum(abs(${transactions.amount}))`,
        count: sql<string>`count(*)`,
        last: sql<string>`max(${transactions.bookedDate})`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.tenantId, tid),
          isNotNull(transactions.vendorId),
          // Money out only: a refund from a supplier is not spend with them.
          sql`${transactions.amount} < 0`,
          notExcluded(),
        ),
      )
      .groupBy(transactions.vendorId),
    db
      .select({
        vendorId: bills.vendorId,
        billed: sql<string>`sum(${bills.total})`,
        paid: sql<string>`sum(${bills.amountPaid})`,
        count: sql<string>`count(*)`,
      })
      .from(bills)
      .where(and(eq(bills.tenantId, tid), sql`${bills.status} <> 'void'`))
      .groupBy(bills.vendorId),
  ]);

  const out = new Map<
    string,
    { spend: number; txCount: number; last: string | null; billed: number; outstanding: number; billCount: number }
  >();
  const ensure = (id: string) =>
    out.get(id) ??
    { spend: 0, txCount: 0, last: null, billed: 0, outstanding: 0, billCount: 0 };

  for (const r of spendRows) {
    const id = r.vendorId as string;
    const e = ensure(id);
    e.spend = round2(Number(r.spend));
    e.txCount = Number(r.count);
    e.last = r.last;
    out.set(id, e);
  }
  for (const r of billRows) {
    const e = ensure(r.vendorId);
    e.billed = round2(Number(r.billed));
    e.outstanding = round2(Number(r.billed) - Number(r.paid));
    e.billCount = Number(r.count);
    out.set(r.vendorId, e);
  }
  return out;
}

export type VendorDetail = NonNullable<Awaited<ReturnType<typeof getVendorDetail>>>;

export async function getVendorDetail(id: string) {
  const tid = tenantId();
  const vendor = await getVendor(id);
  if (!vendor) return null;

  const [txs, billRows, cats] = await Promise.all([
    db
      .select()
      .from(transactions)
      .where(and(eq(transactions.tenantId, tid), eq(transactions.vendorId, id)))
      .orderBy(desc(transactions.bookedDate)),
    db
      .select()
      .from(bills)
      .where(and(eq(bills.tenantId, tid), eq(bills.vendorId, id)))
      .orderBy(desc(bills.issueDate)),
    db.select().from(categories).where(eq(categories.tenantId, tid)),
  ]);

  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const counted = txs.filter((t) => !t.excluded);
  const paidOut = counted.filter((t) => t.amount < 0);
  const refunds = counted.filter((t) => t.amount > 0);

  // Which bank lines are already accounted for by a bill payment, so the detail
  // page can offer only the rest when posting a bill against a transaction.
  const linked = new Set(
    (
      await db
        .select({ t: billPayments.transactionId })
        .from(billPayments)
        .where(and(eq(billPayments.tenantId, tid), isNotNull(billPayments.transactionId)))
    ).map((r) => r.t as string),
  );

  const byYear = new Map<string, { year: string; spend: number; count: number }>();
  for (const t of paidOut) {
    const year = (t.bookedDate || "").slice(0, 4);
    const y = byYear.get(year) ?? { year, spend: 0, count: 0 };
    y.spend = round2(y.spend + Math.abs(t.amount));
    y.count += 1;
    byYear.set(year, y);
  }

  const liveBills = billRows.filter((b) => b.status !== "void");
  const today = new Date().toISOString().slice(0, 10);

  return {
    vendor,
    transactions: txs.map((t) => ({ ...t, billLinked: linked.has(t.id) })),
    bills: billRows.map((b) => ({
      ...b,
      outstanding: round2(b.total - b.amountPaid),
      overdue: !!b.dueDate && b.dueDate < today && round2(b.total - b.amountPaid) > 0.005,
      categoryName: b.categoryId ? (catName.get(b.categoryId) ?? null) : null,
    })),
    totals: {
      lifetimeSpend: round2(paidOut.reduce((s, t) => s + Math.abs(t.amount), 0)),
      txCount: paidOut.length,
      refunded: round2(refunds.reduce((s, t) => s + t.amount, 0)),
      refundCount: refunds.length,
      excludedCount: txs.length - counted.length,
      firstPaid: paidOut.length ? paidOut[paidOut.length - 1].bookedDate : null,
      lastPaid: paidOut.length ? paidOut[0].bookedDate : null,
      billed: round2(liveBills.reduce((s, b) => s + b.total, 0)),
      billsOutstanding: round2(liveBills.reduce((s, b) => s + (b.total - b.amountPaid), 0)),
      billCount: liveBills.length,
      vatReclaimable: round2(liveBills.reduce((s, b) => s + b.vatTotal, 0)),
    },
    byYear: [...byYear.values()].sort((a, b) => b.year.localeCompare(a.year)),
  };
}

/** Attaches (or clears) a vendor on the given transactions. */
export async function setTransactionVendor(
  transactionIds: string[],
  vendorId: string | null,
): Promise<{ updated: number }> {
  if (transactionIds.length === 0) return { updated: 0 };
  const tid = tenantId();
  if (vendorId) {
    // The column's foreign key knows nothing about tenants, so ownership is
    // checked here before anything is written.
    const owns = await getVendor(vendorId);
    if (!owns) throw new Error(`vendor ${vendorId} does not belong to this business`);
  }
  const updated = await db
    .update(transactions)
    .set({ vendorId })
    .where(and(eq(transactions.tenantId, tid), inArray(transactions.id, transactionIds)))
    .returning({ id: transactions.id });
  return { updated: updated.length };
}
