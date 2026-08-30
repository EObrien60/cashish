import { and, desc, eq, isNotNull, lte, sql } from "drizzle-orm";
import { db, first, schema, tenantId } from "@cashish/core/db";
import { uid } from "./id";
import { round2 } from "./format";
import { putBlob, getBlob, deleteBlob } from "./storage";
import { getVendor } from "./vendors";

const { bills, billPayments, transactions, vendors } = schema;

// ---------------------------------------------------------------------------
// Bills: a supplier's invoice to you.
//
// Three ways one arrives, all supported by the same record:
//
//   1. It turns up before you pay it        -> a payable, status "awaiting"
//   2. You already paid it by bank transfer -> posted against that transaction
//   3. You pay it in parts                  -> several payments against one bill
//
// Status is derived from money paid, never set by hand except for "void". That
// mirrors sales invoices, so there is one rule about what "paid" means rather
// than two that can disagree.
// ---------------------------------------------------------------------------

export const ALLOWED_BILL_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
];

export type BillInput = {
  vendorId: string;
  number?: string;
  issueDate: string;
  dueDate?: string | null;
  /** Net and VAT as printed. Total is derived so it cannot disagree with them. */
  net: number;
  vatTotal: number;
  categoryId?: string | null;
  vatRateId?: string | null;
  notes?: string;
  file?: { name: string; type: string; bytes: Buffer } | null;
  /** Post it straight against a bank line that already paid it. */
  paidByTransactionId?: string | null;
};

const ofTenant = () => eq(bills.tenantId, tenantId());

export async function getBill(id: string) {
  const tid = tenantId();
  const bill = first(
    await db
      .select()
      .from(bills)
      .where(and(ofTenant(), eq(bills.id, id)))
      .limit(1),
  );
  if (!bill) return null;
  const payments = await db
    .select()
    .from(billPayments)
    .where(and(eq(billPayments.tenantId, tid), eq(billPayments.billId, id)))
    .orderBy(desc(billPayments.date));
  return { ...bill, payments, outstanding: round2(bill.total - bill.amountPaid) };
}

export async function createBill(input: BillInput) {
  const tid = tenantId();
  const vendor = await getVendor(input.vendorId);
  if (!vendor) throw new Error("that vendor does not belong to this business");

  const net = round2(input.net);
  const vatTotal = round2(input.vatTotal);
  const total = round2(net + vatTotal);
  const id = uid();

  // The document, if one was supplied. Stored privately, namespaced per tenant.
  let file = { fileName: "", mimeType: "", fileSize: 0, storagePath: "" };
  if (input.file && input.file.bytes.length > 0) {
    const ext = input.file.name.includes(".")
      ? input.file.name.slice(input.file.name.lastIndexOf("."))
      : "";
    const stored = await putBlob(
      `tenants/${tid}/bills/${id}${ext}`,
      input.file.bytes,
      input.file.type || "application/octet-stream",
    );
    file = {
      fileName: input.file.name,
      mimeType: input.file.type || "application/octet-stream",
      fileSize: input.file.bytes.length,
      storagePath: stored.pathname,
    };
  }

  await db.insert(bills).values({
    id,
    tenantId: tid,
    vendorId: input.vendorId,
    number: input.number?.trim() ?? "",
    status: "awaiting",
    issueDate: input.issueDate,
    dueDate: input.dueDate ?? null,
    net,
    vatTotal,
    total,
    amountPaid: 0,
    categoryId: input.categoryId ?? vendor.defaultCategoryId ?? null,
    vatRateId: input.vatRateId ?? null,
    notes: input.notes ?? "",
    ...file,
  });

  if (input.paidByTransactionId) {
    await postBillToTransaction(id, input.paidByTransactionId);
  } else {
    await recomputeBillStatus(id);
  }
  return getBill(id);
}

/**
 * Posts a bill against a bank transaction: this payment was for this bill.
 *
 * The amount comes from the transaction, not from the bill, because the bank is
 * the fact. If they differ the bill is left partly paid rather than being
 * quietly rounded to agree.
 */
export async function postBillToTransaction(billId: string, transactionId: string) {
  const tid = tenantId();
  const bill = first(
    await db
      .select()
      .from(bills)
      .where(and(ofTenant(), eq(bills.id, billId)))
      .limit(1),
  );
  if (!bill) throw new Error("no such bill");

  const tx = first(
    await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.tenantId, tid), eq(transactions.id, transactionId)))
      .limit(1),
  );
  if (!tx) throw new Error("no such transaction");
  if (tx.amount >= 0) {
    throw new Error("that transaction is money in, so it cannot pay a bill");
  }
  if (tx.bookedDate < bill.issueDate) {
    throw new Error(
      "that payment left the account before the bill was issued, so it cannot be what paid it",
    );
  }

  const already = first(
    await db
      .select({ id: billPayments.id })
      .from(billPayments)
      .where(and(eq(billPayments.tenantId, tid), eq(billPayments.transactionId, transactionId)))
      .limit(1),
  );
  if (already) throw new Error("that transaction is already posted to a bill");

  await db.insert(billPayments).values({
    id: uid(),
    tenantId: tid,
    billId,
    date: tx.bookedDate,
    amount: round2(Math.abs(tx.amount)),
    method: "bank",
    transactionId,
    note: `Posted from bank: ${(tx.description ?? "").slice(0, 60)}`,
  });

  // Attribute the bank line to the vendor too, so lifetime spend reflects it.
  await db
    .update(transactions)
    .set({ vendorId: bill.vendorId })
    .where(and(eq(transactions.tenantId, tid), eq(transactions.id, transactionId)));

  await recomputeBillStatus(billId);
  return getBill(billId);
}

export async function recordBillPayment(
  billId: string,
  data: { date: string; amount: number; method?: string; note?: string },
) {
  const tid = tenantId();
  await db.insert(billPayments).values({
    id: uid(),
    tenantId: tid,
    billId,
    date: data.date,
    amount: round2(Math.abs(data.amount)),
    method: data.method ?? "bank",
    transactionId: null,
    note: data.note ?? "",
  });
  await recomputeBillStatus(billId);
  return getBill(billId);
}

export async function deleteBillPayment(paymentId: string) {
  const tid = tenantId();
  const p = first(
    await db
      .select()
      .from(billPayments)
      .where(and(eq(billPayments.tenantId, tid), eq(billPayments.id, paymentId)))
      .limit(1),
  );
  if (!p) return;
  await db
    .delete(billPayments)
    .where(and(eq(billPayments.tenantId, tid), eq(billPayments.id, paymentId)));
  await recomputeBillStatus(p.billId);
}

/** Status follows the money, except for the manual "void". */
async function recomputeBillStatus(billId: string) {
  const tid = tenantId();
  const bill = first(
    await db
      .select()
      .from(bills)
      .where(and(ofTenant(), eq(bills.id, billId)))
      .limit(1),
  );
  if (!bill) return;
  const paidRows = await db
    .select({ amount: billPayments.amount })
    .from(billPayments)
    .where(and(eq(billPayments.tenantId, tid), eq(billPayments.billId, billId)));
  const paid = round2(paidRows.reduce((s, p) => s + p.amount, 0));

  let status = bill.status;
  if (status !== "void") {
    if (paid <= 0.005) status = "awaiting";
    else if (paid + 0.005 < bill.total) status = "partial";
    else status = "paid";
  }
  await db
    .update(bills)
    .set({ amountPaid: paid, status })
    .where(and(eq(bills.tenantId, tid), eq(bills.id, billId)));
}

export async function setBillStatus(id: string, status: "awaiting" | "void") {
  await db.update(bills).set({ status }).where(and(ofTenant(), eq(bills.id, id)));
  if (status !== "void") await recomputeBillStatus(id);
  return getBill(id);
}

export async function deleteBill(id: string) {
  const tid = tenantId();
  const bill = first(
    await db
      .select()
      .from(bills)
      .where(and(ofTenant(), eq(bills.id, id)))
      .limit(1),
  );
  if (!bill) return;
  if (bill.storagePath) await deleteBlob(bill.storagePath);
  await db
    .delete(billPayments)
    .where(and(eq(billPayments.tenantId, tid), eq(billPayments.billId, id)));
  await db.delete(bills).where(and(eq(bills.tenantId, tid), eq(bills.id, id)));
}

export async function getBillFile(id: string) {
  const bill = first(
    await db
      .select()
      .from(bills)
      .where(and(ofTenant(), eq(bills.id, id)))
      .limit(1),
  );
  if (!bill || !bill.storagePath) return null;
  return { meta: bill, bytes: await getBlob(bill.storagePath) };
}

/** Everything owed, oldest first — the payables run. */
export async function listPayables() {
  const tid = tenantId();
  const rows = await db
    .select({
      id: bills.id,
      number: bills.number,
      issueDate: bills.issueDate,
      dueDate: bills.dueDate,
      total: bills.total,
      amountPaid: bills.amountPaid,
      status: bills.status,
      vendorId: vendors.id,
      vendorName: vendors.name,
    })
    .from(bills)
    .innerJoin(vendors, and(eq(bills.vendorId, vendors.id), eq(vendors.tenantId, tid)))
    .where(and(eq(bills.tenantId, tid), sql`${bills.status} in ('awaiting','partial')`))
    .orderBy(bills.dueDate, bills.issueDate);
  const today = new Date().toISOString().slice(0, 10);
  return rows
    .map((r) => ({
      ...r,
      outstanding: round2(r.total - r.amountPaid),
      overdue: !!r.dueDate && r.dueDate < today,
    }))
    .filter((r) => r.outstanding > 0.005);
}

/**
 * Bank lines that could plausibly be what paid this bill.
 *
 * Money out, not already posted to another bill, on or after the bill's issue
 * date, and within a tolerance of the amount owed — closest first. Deliberately
 * a short list of candidates rather than an automatic match: posting the wrong
 * payment to a bill is worse than posting none.
 */
export async function candidateTransactionsFor(billId: string) {
  const tid = tenantId();
  const bill = await getBill(billId);
  if (!bill) return [];

  const linked = new Set(
    (
      await db
        .select({ t: billPayments.transactionId })
        .from(billPayments)
        .where(and(eq(billPayments.tenantId, tid), isNotNull(billPayments.transactionId)))
    ).map((r) => r.t as string),
  );

  const rows = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tid),
        lte(transactions.amount, -0.005),
        eq(transactions.excluded, false),
        sql`${transactions.bookedDate} >= ${bill.issueDate}`,
      ),
    )
    .orderBy(desc(transactions.bookedDate));

  const owed = bill.outstanding > 0.005 ? bill.outstanding : bill.total;
  return rows
    .filter((t) => !linked.has(t.id))
    .map((t) => ({
      id: t.id,
      date: t.bookedDate,
      amount: round2(Math.abs(t.amount)),
      description: t.description ?? "",
      delta: round2(Math.abs(Math.abs(t.amount) - owed)),
      exact: Math.abs(Math.abs(t.amount) - owed) <= 0.02,
    }))
    .sort((a, b) => a.delta - b.delta || b.date.localeCompare(a.date))
    .slice(0, 25);
}
