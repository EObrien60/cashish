import { db, first, schema, tenantId } from "@cashish/core/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
  /**
   * The invoice's own number. Supply it when copying a historic invoice in from another
   * system: the number on the document the customer already has is the number the books
   * must show. Omitted for anything new, which takes the next in sequence.
   */
  number?: string;
  status?: string;
  issueDate: string;
  dueDate?: string | null;
  notes?: string;
  terms?: string;
  lines: LineInput[];
};

/**
 * Resolves every VAT rate a set of lines needs in one query.
 *
 * The SQLite version looked one rate up per line. That was free on a local file
 * and is a round-trip per line against Neon, so an eight-line invoice paid eight
 * network latencies to compute a total.
 */
async function ratesFor(lines: LineInput[]): Promise<Map<string, number>> {
  const ids = [...new Set(lines.map((l) => l.vatRateId).filter((v): v is string => !!v))];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: vatRates.id, rate: vatRates.rate })
    .from(vatRates)
    .where(and(eq(vatRates.tenantId, tenantId()), inArray(vatRates.id, ids)));
  return new Map(rows.map((r) => [r.id, r.rate]));
}

async function computeLines(lines: LineInput[]) {
  const rates = await ratesFor(lines);
  let subtotal = 0;
  let vatTotal = 0;
  const computed = lines.map((l, i) => {
    const rate = l.vatRateId ? (rates.get(l.vatRateId) ?? 0) : 0;
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

const formatNumber = (prefix: string, seq: number) =>
  `${prefix}${String(seq).padStart(4, "0")}`;

/** What the next generated invoice number *would* be. Read-only — for display. */
export async function nextInvoiceNumber(): Promise<string> {
  const s = first(
    await db
      .select()
      .from(settings)
      .where(eq(settings.tenantId, tenantId()))
      .limit(1),
  );
  return formatNumber(s?.invoicePrefix ?? "INV-", Number(s?.nextInvoiceSeq ?? 1));
}

/**
 * Takes the next number and advances the sequence in one statement.
 *
 * The SQLite version read next_invoice_seq and wrote back seq + 1. Single-user on
 * a local file that was safe; with more than one client — a browser and an MCP
 * agent, say — two invoices could read the same value and take the same number.
 * `RETURNING` on the increment makes claiming a number atomic.
 */
async function consumeInvoiceNumber(
  trx: Pick<typeof db, "update">,
  tid: string,
): Promise<string> {
  const [row] = await trx
    .update(settings)
    .set({ nextInvoiceSeq: sql`${settings.nextInvoiceSeq} + 1` })
    .where(eq(settings.tenantId, tid))
    .returning({ seq: settings.nextInvoiceSeq, prefix: settings.invoicePrefix });
  if (!row) throw new Error(`no settings row for tenant ${tid}`);
  // RETURNING yields the post-increment value, so the number just claimed is one less.
  return formatNumber(row.prefix ?? "INV-", Number(row.seq) - 1);
}

export async function createInvoice(input: InvoiceInput) {
  const id = uid();
  const tid = tenantId();
  // A supplied number is used verbatim and leaves the sequence alone — importing history
  // must not push the next new invoice's number forward.
  const supplied = input.number?.trim();
  const { computed, subtotal, vatTotal, total } = await computeLines(input.lines);

  await db.transaction(async (trx) => {
    const number = supplied || (await consumeInvoiceNumber(trx, tid));
    await trx.insert(invoices).values({
      id,
      tenantId: tid,
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
    });
    if (computed.length) {
      await trx
        .insert(invoiceLines)
        .values(computed.map((c) => ({ ...c, tenantId: tid, invoiceId: id })));
    }
  });

  return getInvoice(id);
}

export async function updateInvoice(id: string, input: InvoiceInput) {
  const tid = tenantId();
  const { computed, subtotal, vatTotal, total } = await computeLines(input.lines);
  await db.transaction(async (trx) => {
    await trx
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
      .where(and(eq(invoices.tenantId, tid), eq(invoices.id, id)));
    await trx
      .delete(invoiceLines)
      .where(and(eq(invoiceLines.tenantId, tid), eq(invoiceLines.invoiceId, id)));
    if (computed.length) {
      await trx
        .insert(invoiceLines)
        .values(computed.map((c) => ({ ...c, tenantId: tid, invoiceId: id })));
    }
  });
  await recomputeInvoiceStatus(id);
  return getInvoice(id);
}

export async function getInvoice(id: string) {
  const tid = tenantId();
  const inv = first(
    await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, tid), eq(invoices.id, id)))
      .limit(1),
  );
  if (!inv) return null;
  const [lines, pays] = await Promise.all([
    db
      .select()
      .from(invoiceLines)
      .where(and(eq(invoiceLines.tenantId, tid), eq(invoiceLines.invoiceId, id)))
      .orderBy(invoiceLines.sortOrder),
    db
      .select()
      .from(payments)
      .where(and(eq(payments.tenantId, tid), eq(payments.invoiceId, id)))
      .orderBy(desc(payments.date)),
  ]);
  return { ...inv, lines, payments: pays };
}

export async function listInvoices() {
  return db
    .select()
    .from(invoices)
    .where(eq(invoices.tenantId, tenantId()))
    .orderBy(desc(invoices.issueDate));
}

export async function deleteInvoice(id: string) {
  const tid = tenantId();
  // invoice_lines and payments cascade from invoices, but they are deleted
  // explicitly so the intent survives a future change to the FK actions.
  await db.transaction(async (trx) => {
    await trx
      .delete(invoiceLines)
      .where(and(eq(invoiceLines.tenantId, tid), eq(invoiceLines.invoiceId, id)));
    await trx
      .delete(payments)
      .where(and(eq(payments.tenantId, tid), eq(payments.invoiceId, id)));
    await trx.delete(invoices).where(and(eq(invoices.tenantId, tid), eq(invoices.id, id)));
  });
}

export async function recordPayment(
  invoiceId: string,
  data: {
    date: string;
    amount: number;
    method?: string;
    transactionId?: string | null;
    note?: string;
  },
) {
  await db.insert(payments).values({
    id: uid(),
    tenantId: tenantId(),
    invoiceId,
    date: data.date,
    amount: round2(data.amount),
    method: data.method ?? "bank",
    transactionId: data.transactionId ?? null,
    note: data.note ?? "",
  });
  await recomputeInvoiceStatus(invoiceId);
  return getInvoice(invoiceId);
}

export async function deletePayment(paymentId: string) {
  const tid = tenantId();
  const p = first(
    await db
      .select()
      .from(payments)
      .where(and(eq(payments.tenantId, tid), eq(payments.id, paymentId)))
      .limit(1),
  );
  if (!p) return;
  await db.delete(payments).where(and(eq(payments.tenantId, tid), eq(payments.id, paymentId)));
  await recomputeInvoiceStatus(p.invoiceId);
}

// Status is derived from money received, except the manual 'void' / 'draft'.
async function recomputeInvoiceStatus(invoiceId: string) {
  const tid = tenantId();
  const inv = first(
    await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, tid), eq(invoices.id, invoiceId)))
      .limit(1),
  );
  if (!inv) return;
  const pays = await db
    .select()
    .from(payments)
    .where(and(eq(payments.tenantId, tid), eq(payments.invoiceId, invoiceId)));
  const paid = round2(pays.reduce((s, p) => s + p.amount, 0));
  let status = inv.status;
  if (status !== "void") {
    if (paid <= 0) status = inv.status === "draft" ? "draft" : "sent";
    else if (paid + 0.005 < inv.total) status = "partial";
    else status = "paid";
  }
  await db
    .update(invoices)
    .set({ amountPaid: paid, status })
    .where(and(eq(invoices.tenantId, tid), eq(invoices.id, invoiceId)));
}

export async function setInvoiceStatus(id: string, status: string) {
  await db
    .update(invoices)
    .set({ status })
    .where(and(eq(invoices.tenantId, tenantId()), eq(invoices.id, id)));
  if (status !== "void" && status !== "draft") await recomputeInvoiceStatus(id);
  return getInvoice(id);
}
