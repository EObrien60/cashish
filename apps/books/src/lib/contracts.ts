import { and, desc, eq, sql } from "drizzle-orm";
import { db, first, schema, tenantId } from "@cashish/core/db";
import { round2, todayISO } from "./format";
import { uid } from "./id";
import { putBlob, getBlob, deleteBlob } from "./storage";
import { extname } from "node:path";

const { contracts, customers, invoices, recurringInvoices } = schema;

// ---------------------------------------------------------------------------
// Contracts.
//
// The agreement a schedule bills for. A recurring invoice knows when to raise
// €5,000; only a contract knows that the deal was €60,000 over a year, that
// €25,000 of it has been invoiced, and where the signed copy is.
//
// A contract may have several billing schedules, or none — a fixed-price
// project is a contract invoiced by hand, and that is not a lesser kind of
// contract. So nothing here requires a schedule to exist.
// ---------------------------------------------------------------------------

const ofTenant = () => eq(contracts.tenantId, tenantId());

export type ContractStatus = "draft" | "active" | "completed" | "cancelled";

export type ContractInput = {
  id?: string;
  customerId: string;
  name: string;
  reference?: string;
  status?: ContractStatus;
  startDate: string;
  endDate?: string | null;
  value?: number | null;
  terms?: string;
  notes?: string;
};

export type ContractSummary = {
  id: string;
  customerId: string;
  customerName: string;
  name: string;
  reference: string;
  status: string;
  startDate: string;
  endDate: string | null;
  value: number | null;
  currency: string;
  /** Total of every invoice raised against it, VAT included. */
  invoiced: number;
  /** Of that, what has actually been received. */
  received: number;
  /**
   * Agreed value less invoiced. Null for an open-ended contract, where the
   * only honest answer is "whatever it bills" — a made-up remaining figure on
   * a retainer is worse than none.
   */
  remaining: number | null;
  invoiceCount: number;
  scheduleCount: number;
  hasDocument: boolean;
  /** True once the end date has passed and the contract is still active. */
  expired: boolean;
};

export async function saveContract(input: ContractInput): Promise<string> {
  const tid = tenantId();
  const id = input.id ?? uid();
  const row = {
    customerId: input.customerId,
    name: input.name.trim(),
    reference: input.reference ?? "",
    status: input.status ?? "active",
    startDate: input.startDate,
    endDate: input.endDate || null,
    value: input.value ?? null,
    terms: input.terms ?? "",
    notes: input.notes ?? "",
  };

  if (input.id) {
    await db.update(contracts).set(row).where(and(ofTenant(), eq(contracts.id, input.id)));
  } else {
    await db.insert(contracts).values({ ...row, id, tenantId: tid });
  }
  return id;
}

export async function listContracts(options: { includeClosed?: boolean } = {}): Promise<
  ContractSummary[]
> {
  const tid = tenantId();
  const rows = await db
    .select({
      c: contracts,
      customerName: customers.name,
    })
    .from(contracts)
    .innerJoin(customers, eq(customers.id, contracts.customerId))
    .where(eq(contracts.tenantId, tid))
    .orderBy(desc(contracts.startDate));

  // One query for the money rather than one per contract.
  const totals = await db
    .select({
      contractId: invoices.contractId,
      invoiced: sql<number>`coalesce(sum(${invoices.total}), 0)`,
      received: sql<number>`coalesce(sum(${invoices.amountPaid}), 0)`,
      n: sql<number>`count(*)`,
    })
    .from(invoices)
    .where(and(eq(invoices.tenantId, tid), sql`${invoices.contractId} is not null`))
    .groupBy(invoices.contractId);
  const byContract = new Map(totals.map((t) => [t.contractId, t]));

  const schedules = await db
    .select({ contractId: recurringInvoices.contractId, n: sql<number>`count(*)` })
    .from(recurringInvoices)
    .where(
      and(eq(recurringInvoices.tenantId, tid), sql`${recurringInvoices.contractId} is not null`),
    )
    .groupBy(recurringInvoices.contractId);
  const scheduleCounts = new Map(schedules.map((s) => [s.contractId, Number(s.n)]));

  const today = todayISO();

  return rows
    .filter((r) => options.includeClosed || !["completed", "cancelled"].includes(r.c.status))
    .map((r) => {
      const money = byContract.get(r.c.id);
      const invoiced = round2(Number(money?.invoiced ?? 0));
      return {
        id: r.c.id,
        customerId: r.c.customerId,
        customerName: r.customerName,
        name: r.c.name,
        reference: r.c.reference ?? "",
        status: r.c.status,
        startDate: r.c.startDate,
        endDate: r.c.endDate,
        value: r.c.value,
        currency: r.c.currency,
        invoiced,
        received: round2(Number(money?.received ?? 0)),
        remaining: r.c.value == null ? null : round2(r.c.value - invoiced),
        invoiceCount: Number(money?.n ?? 0),
        scheduleCount: scheduleCounts.get(r.c.id) ?? 0,
        hasDocument: Boolean(r.c.documentPath),
        expired: Boolean(r.c.endDate && r.c.endDate < today && r.c.status === "active"),
      };
    });
}

export async function getContract(id: string) {
  const row = first(
    await db
      .select({ c: contracts, customerName: customers.name })
      .from(contracts)
      .innerJoin(customers, eq(customers.id, contracts.customerId))
      .where(and(ofTenant(), eq(contracts.id, id)))
      .limit(1),
  );
  if (!row) return null;

  const [raised, schedules] = await Promise.all([
    db
      .select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId()), eq(invoices.contractId, id)))
      .orderBy(desc(invoices.issueDate)),
    db
      .select()
      .from(recurringInvoices)
      .where(
        and(eq(recurringInvoices.tenantId, tenantId()), eq(recurringInvoices.contractId, id)),
      ),
  ]);

  return { ...row.c, customerName: row.customerName, invoices: raised, schedules };
}

export async function setContractStatus(id: string, status: ContractStatus) {
  await db.update(contracts).set({ status }).where(and(ofTenant(), eq(contracts.id, id)));
}

export async function deleteContract(id: string) {
  const existing = first(
    await db.select().from(contracts).where(and(ofTenant(), eq(contracts.id, id))).limit(1),
  );
  if (!existing) return;
  // The blob goes with it; an orphaned document in a private store is a bill
  // nobody can explain.
  if (existing.documentPath) await deleteBlob(existing.documentPath).catch(() => {});
  await db.delete(contracts).where(and(ofTenant(), eq(contracts.id, id)));
}

// --- the signed copy --------------------------------------------------------

export async function attachDocument(
  contractId: string,
  file: { name: string; type: string; bytes: Buffer },
) {
  const tid = tenantId();
  const existing = first(
    await db.select().from(contracts).where(and(ofTenant(), eq(contracts.id, contractId))).limit(1),
  );
  if (!existing) throw new Error("No such contract.");

  const pathname = `tenants/${tid}/contracts/${contractId}${extname(file.name) || ""}`;
  await putBlob(pathname, file.bytes, file.type || "application/octet-stream");
  // Replacing a document overwrites the same path, so there is nothing to
  // clean up and no way to end up with two.
  await db
    .update(contracts)
    .set({
      documentPath: pathname,
      documentName: file.name,
      documentMime: file.type || "application/octet-stream",
      documentSize: file.bytes.length,
    })
    .where(and(ofTenant(), eq(contracts.id, contractId)));
}

export async function getDocument(contractId: string) {
  const row = first(
    await db.select().from(contracts).where(and(ofTenant(), eq(contracts.id, contractId))).limit(1),
  );
  if (!row?.documentPath) return null;
  const bytes = await getBlob(row.documentPath);
  if (!bytes) return null;
  return { bytes, name: row.documentName || "contract", mime: row.documentMime };
}

/**
 * What contracts commit the business to over a window.
 *
 * The gap this closes: the cash flow forecast counts open invoices and
 * recurring schedules, so a signed twelve-month contract that has not been
 * invoiced yet is invisible to it. This does not invent invoices — it reports
 * what is agreed but not yet raised, so the forecast can say so rather than
 * quietly understate the year.
 */
export async function committedButUninvoiced(): Promise<{
  total: number;
  contracts: { id: string; name: string; customerName: string; remaining: number }[];
}> {
  const list = await listContracts();
  const open = list.filter(
    (c) => c.status === "active" && c.remaining != null && c.remaining > 0,
  );
  return {
    total: round2(open.reduce((acc, c) => acc + (c.remaining ?? 0), 0)),
    contracts: open.map((c) => ({
      id: c.id,
      name: c.name,
      customerName: c.customerName,
      remaining: c.remaining ?? 0,
    })),
  };
}
