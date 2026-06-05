import { db, schema } from "@/db/client";
import { and, desc, eq } from "drizzle-orm";
import { uid } from "./id";
import { round2 } from "./format";

const { invoices, invoiceLines, payments, settings, vatRates } = schema;

export type LineInput = {
  productId?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  vatRateId?: string | null;
};

export type InvoiceInput = {
  customerId: string;
  status?: string;
  issueDate: string;
  dueDate?: string | null;
  notes?: string;
  terms?: string;
  lines: LineInput[];
};

function rateFor(vatRateId?: string | null): number {
  if (!vatRateId) return 0;
  const r = db.select().from(vatRates).where(eq(vatRates.id, vatRateId)).get();
  return r?.rate ?? 0;
}

function computeLines(lines: LineInput[]) {
  let subtotal = 0;
  let vatTotal = 0;
  const computed = lines.map((l, i) => {
    const rate = rateFor(l.vatRateId);
    const net = round2(l.quantity * l.unitPrice);
    const vat = round2(net * rate);
    subtotal += net;
    vatTotal += vat;
    return {
      id: uid(),
      productId: l.productId ?? null,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      vatRateId: l.vatRateId ?? null,
      vatRate: rate,
      lineNet: net,
      lineVat: vat,
      lineTotal: round2(net + vat),
      sortOrder: i,
    };
  });
  subtotal = round2(subtotal);
  vatTotal = round2(vatTotal);
  return { computed, subtotal, vatTotal, total: round2(subtotal + vatTotal) };
}

export function nextInvoiceNumber(): string {
  const s = db.select().from(settings).where(eq(settings.id, 1)).get();
  const prefix = s?.invoicePrefix ?? "INV-";
  const seq = s?.nextInvoiceSeq ?? 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

export function createInvoice(input: InvoiceInput) {
  const id = uid();
  const number = nextInvoiceNumber();
  const { computed, subtotal, vatTotal, total } = computeLines(input.lines);

  db.transaction((trx) => {
    trx
      .insert(invoices)
      .values({
        id,
        number,
        customerId: input.customerId,
        status: input.status ?? "draft",
        issueDate: input.issueDate,
        dueDate: input.dueDate ?? null,
        currency: "EUR",
        notes: input.notes ?? "",
        terms: input.terms ?? "",
        subtotal,
        vatTotal,
        total,
        amountPaid: 0,
      })
      .run();
    for (const c of computed) {
      trx.insert(invoiceLines).values({ ...c, invoiceId: id }).run();
    }
    // bump sequence
    const s = trx.select().from(settings).where(eq(settings.id, 1)).get();
    trx
      .update(settings)
      .set({ nextInvoiceSeq: (s?.nextInvoiceSeq ?? 1) + 1 })
      .where(eq(settings.id, 1))
      .run();
  });

  return getInvoice(id);
}

export function updateInvoice(id: string, input: InvoiceInput) {
  const { computed, subtotal, vatTotal, total } = computeLines(input.lines);
  db.transaction((trx) => {
    trx
      .update(invoices)
      .set({
        customerId: input.customerId,
        status: input.status,
        issueDate: input.issueDate,
        dueDate: input.dueDate ?? null,
        notes: input.notes ?? "",
        terms: input.terms ?? "",
        subtotal,
        vatTotal,
        total,
      })
      .where(eq(invoices.id, id))
      .run();
    trx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, id)).run();
    for (const c of computed) {
      trx.insert(invoiceLines).values({ ...c, invoiceId: id }).run();
    }
  });
  recomputeInvoiceStatus(id);
  return getInvoice(id);
}

export function getInvoice(id: string) {
  const inv = db.select().from(invoices).where(eq(invoices.id, id)).get();
  if (!inv) return null;
  const lines = db
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, id))
    .orderBy(invoiceLines.sortOrder)
    .all();
  const pays = db
    .select()
    .from(payments)
    .where(eq(payments.invoiceId, id))
    .orderBy(desc(payments.date))
    .all();
  return { ...inv, lines, payments: pays };
}

export function listInvoices() {
  return db.select().from(invoices).orderBy(desc(invoices.issueDate)).all();
}

export function deleteInvoice(id: string) {
  db.transaction((trx) => {
    trx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, id)).run();
    trx.delete(payments).where(eq(payments.invoiceId, id)).run();
    trx.delete(invoices).where(eq(invoices.id, id)).run();
  });
}

export function recordPayment(
  invoiceId: string,
  data: { date: string; amount: number; method?: string; transactionId?: string | null; note?: string },
) {
  db.insert(payments)
    .values({
      id: uid(),
      invoiceId,
      date: data.date,
      amount: round2(data.amount),
      method: data.method ?? "bank",
      transactionId: data.transactionId ?? null,
      note: data.note ?? "",
    })
    .run();
  recomputeInvoiceStatus(invoiceId);
  return getInvoice(invoiceId);
}

export function deletePayment(paymentId: string) {
  const p = db.select().from(payments).where(eq(payments.id, paymentId)).get();
  if (!p) return;
  db.delete(payments).where(eq(payments.id, paymentId)).run();
  recomputeInvoiceStatus(p.invoiceId);
}

// Status is derived from money received, except the manual 'void' / 'draft'.
function recomputeInvoiceStatus(invoiceId: string) {
  const inv = db.select().from(invoices).where(eq(invoices.id, invoiceId)).get();
  if (!inv) return;
  const pays = db
    .select()
    .from(payments)
    .where(eq(payments.invoiceId, invoiceId))
    .all();
  const paid = round2(pays.reduce((s, p) => s + p.amount, 0));
  let status = inv.status;
  if (status !== "void") {
    if (paid <= 0) status = inv.status === "draft" ? "draft" : "sent";
    else if (paid + 0.005 < inv.total) status = "partial";
    else status = "paid";
  }
  db.update(invoices)
    .set({ amountPaid: paid, status })
    .where(eq(invoices.id, invoiceId))
    .run();
}

export function setInvoiceStatus(id: string, status: string) {
  db.update(invoices).set({ status }).where(eq(invoices.id, id)).run();
  if (status !== "void" && status !== "draft") recomputeInvoiceStatus(id);
  return getInvoice(id);
}
