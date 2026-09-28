import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { generateObject } from "ai";
import { z } from "zod";
import { createHash } from "node:crypto";
import { extname } from "node:path";
import { db, first, schema, tenantId } from "@cashish/core/db";
import { REPORT_MODEL, aiIsConfigured, describeFailure, gatewayOptions, type AiResult } from "./ai";
import { putBlob, getBlob, deleteBlob } from "./storage";
import { round2, addDays } from "./format";
import { uid } from "./id";
import { notExcluded, notTransfer } from "./transactions";

const { documents, transactions, bills, billPayments, receipts, vendors, categories } = schema;

// ---------------------------------------------------------------------------
// Reading a document.
//
// Somebody empties a folder of invoices, payslips and till receipts into this,
// and each one becomes fields. What it does NOT do is put any of them in the
// books: an invoice read wrongly and posted silently is a wrong number in a VAT
// return that nobody goes looking for. Every document is a PROPOSAL until it is
// confirmed, and confirming goes through the ordinary domain functions.
//
// The extraction is kept after confirmation as well, because "why does this
// bill say €81.60?" should always be answerable by looking at what was read.
// ---------------------------------------------------------------------------

const LineSchema = z.object({
  description: z.string(),
  quantity: z.number().nullable(),
  unitPrice: z.number().nullable(),
  total: z.number().nullable(),
});

const ExtractionSchema = z.object({
  kind: z
    .enum(["bill", "receipt", "sales_invoice", "payslip", "other"])
    .describe(
      "bill = someone invoicing you. sales_invoice = you invoicing someone. receipt = proof of a card payment. payslip = wages.",
    ),
  confidence: z.enum(["high", "medium", "low"]),
  counterparty: z.string().nullable().describe("Who issued it — the supplier, employer or shop."),
  documentNumber: z.string().nullable(),
  issueDate: z.string().nullable().describe("YYYY-MM-DD, or null if not printed."),
  dueDate: z.string().nullable().describe("YYYY-MM-DD, or null."),
  currency: z.string().nullable().describe("ISO code, e.g. EUR."),
  net: z.number().nullable().describe("Total before tax."),
  tax: z.number().nullable().describe("VAT or tax amount."),
  gross: z.number().nullable().describe("Total payable, including tax."),
  lines: z.array(LineSchema).max(30),
  notes: z.string().nullable().describe("Anything that would not fit the fields but matters."),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

const SYSTEM = `You read business documents into fields.

Copy what is printed. Do not compute, infer or tidy:
- If a total is not printed, return null. Do not add up the lines to produce one.
- If a date is ambiguous, prefer the one labelled as the invoice or issue date,
  and return null rather than guessing between formats.
- Amounts are numbers without currency symbols or thousand separators. A credit
  or refund is negative.
- Return the currency actually shown, not the one you would expect.

Set confidence to "low" whenever the document is unclear, partly cut off, or
you are unsure what kind of document it is. Low confidence is useful; a
confident wrong answer is not.`;

export async function saveDocument(file: {
  name: string;
  type: string;
  bytes: Buffer;
}): Promise<string> {
  const tid = tenantId();
  const id = uid();
  const pathname = `tenants/${tid}/documents/${id}${extname(file.name) || ""}`;
  await putBlob(pathname, file.bytes, file.type || "application/octet-stream");

  await db.insert(documents).values({
    id,
    tenantId: tid,
    sha256: sha256Hex(file.bytes),
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.bytes.length,
    storagePath: pathname,
    status: "pending",
  });
  return id;
}

export const sha256Hex = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** The earliest document in this book with exactly these bytes, if any. */
export async function findDocumentBySha256(sha256: string): Promise<DocumentRow | null> {
  const doc = first(
    await db
      .select()
      .from(documents)
      .where(and(eq(documents.tenantId, tenantId()), eq(documents.sha256, sha256)))
      .orderBy(asc(documents.uploadedAt))
      .limit(1),
  );
  return doc ? toRow(doc) : null;
}

/** One document as a DocumentRow, or null if it is not in this book. */
export async function getDocument(id: string): Promise<DocumentRow | null> {
  const doc = first(
    await db.select().from(documents).where(and(eq(documents.tenantId, tenantId()), eq(documents.id, id))).limit(1),
  );
  return doc ? toRow(doc) : null;
}

/** Reads one stored document. Safe to re-run: it overwrites its own extraction. */
export async function extractDocument(id: string): Promise<AiResult<Extraction>> {
  const tid = tenantId();
  const doc = first(
    await db.select().from(documents).where(and(eq(documents.tenantId, tid), eq(documents.id, id))).limit(1),
  );
  if (!doc) return { ok: false, reason: "No such document." };

  if (!aiIsConfigured()) {
    return {
      ok: false,
      reason: "No AI credentials on this deployment, so documents cannot be read automatically.",
    };
  }

  const bytes = await getBlob(doc.storagePath);
  if (!bytes) return { ok: false, reason: "The stored file could not be read back." };

  try {
    const result = await generateObject({
      model: REPORT_MODEL,
      schema: ExtractionSchema,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `Read this document. Its file name is "${doc.fileName}".` },
            { type: "file", data: bytes, mediaType: doc.mimeType },
          ],
        },
      ],
      providerOptions: gatewayOptions("document-extraction", tid),
    });

    await db
      .update(documents)
      .set({
        kind: result.object.kind,
        extraction: JSON.stringify(result.object),
        status: "pending",
        error: "",
      })
      .where(and(eq(documents.tenantId, tid), eq(documents.id, id)));

    return { ok: true, value: result.object };
  } catch (error) {
    const failure = describeFailure(error);
    await db
      .update(documents)
      .set({ status: "failed", error: failure.reason })
      .where(and(eq(documents.tenantId, tid), eq(documents.id, id)));
    return failure;
  }
}

export type DocumentRow = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  status: string;
  kind: string;
  error: string;
  uploadedAt: string;
  extraction: Extraction | null;
  billId: string | null;
  transactionId: string | null;
};

function parseExtraction(raw: string | null): Extraction | null {
  if (!raw) return null;
  try {
    return ExtractionSchema.parse(JSON.parse(raw));
  } catch {
    // A stored extraction that no longer fits the schema is not a crash; the
    // document simply reads as unextracted and can be run again.
    return null;
  }
}

export async function listDocuments(status?: string): Promise<DocumentRow[]> {
  const rows = await db
    .select()
    .from(documents)
    .where(
      status
        ? and(eq(documents.tenantId, tenantId()), eq(documents.status, status))
        : eq(documents.tenantId, tenantId()),
    )
    .orderBy(desc(documents.uploadedAt));

  return rows.map(toRow);
}

function toRow(d: typeof documents.$inferSelect): DocumentRow {
  return {
    id: d.id,
    fileName: d.fileName,
    mimeType: d.mimeType,
    size: d.size,
    status: d.status,
    kind: d.kind,
    error: d.error ?? "",
    uploadedAt: d.uploadedAt,
    extraction: parseExtraction(d.extraction),
    billId: d.billId,
    transactionId: d.transactionId,
  };
}

export async function getDocumentFile(id: string) {
  const doc = first(
    await db.select().from(documents).where(and(eq(documents.tenantId, tenantId()), eq(documents.id, id))).limit(1),
  );
  if (!doc) return null;
  const bytes = await getBlob(doc.storagePath);
  if (!bytes) return null;
  return { bytes, name: doc.fileName, mime: doc.mimeType };
}

/**
 * Bank lines this document might be the paperwork for.
 *
 * Deterministic, and deliberately generous: same amount to the cent, within
 * three weeks either side of the document's date. The person picks; a wrong
 * automatic match would attach an invoice to somebody else's payment.
 */
export async function candidateTransactions(id: string) {
  const doc = first(
    await db.select().from(documents).where(and(eq(documents.tenantId, tenantId()), eq(documents.id, id))).limit(1),
  );
  const extraction = parseExtraction(doc?.extraction ?? null);
  if (!extraction?.gross || !extraction.issueDate) return [];

  const amount = round2(Math.abs(extraction.gross));
  const rows = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tenantId()),
        notExcluded(),
        gte(transactions.bookedDate, addDays(extraction.issueDate, -21)),
        lte(transactions.bookedDate, addDays(extraction.issueDate, 21)),
        sql`abs(abs(${transactions.amount}) - ${amount}) < 0.005`,
      ),
    )
    .limit(10);

  return rows.map((t) => ({
    id: t.id,
    date: t.bookedDate,
    amount: t.amount,
    description: t.description ?? "",
  }));
}

export async function rejectDocument(id: string) {
  await db
    .update(documents)
    .set({ status: "rejected", reviewedAt: new Date().toISOString() })
    .where(and(eq(documents.tenantId, tenantId()), eq(documents.id, id)));
}

export async function deleteDocument(id: string) {
  const tid = tenantId();
  const doc = first(
    await db.select().from(documents).where(and(eq(documents.tenantId, tid), eq(documents.id, id))).limit(1),
  );
  if (!doc) return;
  if (doc.storagePath) await deleteBlob(doc.storagePath).catch(() => {});
  await db.delete(documents).where(and(eq(documents.tenantId, tid), eq(documents.id, id)));
}

export async function linkToTransaction(id: string, transactionId: string) {
  await db
    .update(documents)
    .set({ transactionId, status: "confirmed", reviewedAt: new Date().toISOString() })
    .where(and(eq(documents.tenantId, tenantId()), eq(documents.id, id)));
}

export async function markConfirmed(id: string, billId?: string) {
  await db
    .update(documents)
    .set({
      status: "confirmed",
      reviewedAt: new Date().toISOString(),
      ...(billId ? { billId } : {}),
    })
    .where(and(eq(documents.tenantId, tenantId()), eq(documents.id, id)));
}

/**
 * Turning a read document into a bill.
 *
 * Everything the person may have corrected on screen arrives as `input`, and
 * that is what is used — not the extraction. The extraction stays as the record
 * of what the model read, which is exactly what makes a correction meaningful.
 *
 * The bill itself is created through the ordinary createBill: same validation,
 * same VAT handling, same posting against a bank line. Nothing here writes to
 * the books directly.
 */
export async function confirmAsBill(
  id: string,
  input: {
    vendorName: string;
    number?: string;
    issueDate: string;
    dueDate?: string | null;
    net: number;
    vatTotal: number;
    categoryId?: string | null;
    paidByTransactionId?: string | null;
  },
): Promise<{ billId: string }> {
  const { createBill } = await import("./bills");
  const { findVendorByName, createVendor } = await import("./vendors");

  const name = input.vendorName.trim();
  if (!name) throw new Error("A bill needs a supplier.");

  // Reuse the supplier if it is already known, so a folder of invoices from one
  // company does not become fifteen vendors with the same name.
  const existing = await findVendorByName(name);
  const vendorId = existing?.id ?? (await createVendor({ name })).vendor.id;

  const file = await getDocumentFile(id);
  const bill = await createBill({
    vendorId,
    ...(input.number ? { number: input.number } : {}),
    issueDate: input.issueDate,
    dueDate: input.dueDate ?? null,
    net: input.net,
    vatTotal: input.vatTotal,
    categoryId: input.categoryId ?? null,
    paidByTransactionId: input.paidByTransactionId ?? null,
    // The invoice travels with the bill, so it is where somebody would look.
    file: file ? { name: file.name, type: file.mime, bytes: file.bytes } : null,
  });

  const billId = typeof bill === "string" ? bill : (bill as { id: string }).id;
  await markConfirmed(id, billId);
  return { billId };
}

/**
 * Putting a document's file on a bill that was entered without one.
 *
 * The enrichment case: the bill is already in the books (typed in, or posted
 * from the bank), and the invoice for it turns up later. Only ever fills an
 * empty slot: a bill that already carries a document keeps it, because
 * replacing one invoice with another is a correction a person should make.
 */
export async function attachBillFile(billId: string, documentId: string): Promise<void> {
  const tid = tenantId();
  const bill = first(
    await db.select().from(bills).where(and(eq(bills.tenantId, tid), eq(bills.id, billId))).limit(1),
  );
  if (!bill) throw new Error("No such bill in this book.");
  if (bill.storagePath) throw new Error("That bill already has a document; it is not replaced.");

  const doc = await getDocument(documentId);
  if (!doc) throw new Error("No such document in this book.");
  if (doc.status === "confirmed" || doc.status === "rejected") {
    throw new Error(`That document is already ${doc.status}.`);
  }
  const file = await getDocumentFile(documentId);
  if (!file) throw new Error("That document's file is no longer in storage.");

  // Same namespacing as createBill, so the bill's file route serves it unchanged.
  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
  const stored = await putBlob(`tenants/${tid}/bills/${billId}${ext}`, file.bytes, file.mime);
  await db
    .update(bills)
    .set({ fileName: file.name, mimeType: file.mime, fileSize: file.bytes.length, storagePath: stored.pathname })
    .where(and(eq(bills.tenantId, tid), eq(bills.id, billId)));
  await markConfirmed(documentId, billId);
}

/**
 * Money out that somebody has already tagged, with nothing to show for it.
 *
 * "Tagged" is a category or a supplier set on the line. "Nothing to show" is no
 * bill posted against it, no receipt and no linked document. This is the list
 * an agent works through to go and find the missing invoices.
 *
 * Wages are left out: a payment to someone on the payroll has a payslip, not a
 * supplier invoice, and would only ever come back as "nothing found".
 */
export async function transactionsMissingDocuments(filter: { from?: string; to?: string; limit?: number } = {}) {
  const tid = tenantId();
  const conds = [
    eq(transactions.tenantId, tid),
    sql`${transactions.amount} < 0`,
    notExcluded(),
    notTransfer(),
    sql`${transactions.employeeId} is null`,
    sql`(${transactions.categoryId} is not null or ${transactions.vendorId} is not null)`,
    sql`not exists (select 1 from ${billPayments} where ${billPayments.tenantId} = ${tid} and ${billPayments.transactionId} = ${transactions.id})`,
    sql`not exists (select 1 from ${receipts} where ${receipts.tenantId} = ${tid} and ${receipts.transactionId} = ${transactions.id})`,
    sql`not exists (select 1 from ${documents} where ${documents.tenantId} = ${tid} and ${documents.transactionId} = ${transactions.id})`,
  ];
  if (filter.from) conds.push(gte(transactions.bookedDate, filter.from));
  if (filter.to) conds.push(lte(transactions.bookedDate, filter.to));

  return db
    .select({
      id: transactions.id,
      date: transactions.bookedDate,
      amount: transactions.amount,
      description: transactions.description,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      vendorId: transactions.vendorId,
      vendorName: vendors.name,
    })
    .from(transactions)
    .leftJoin(categories, and(eq(categories.id, transactions.categoryId), eq(categories.tenantId, tid)))
    .leftJoin(vendors, and(eq(vendors.id, transactions.vendorId), eq(vendors.tenantId, tid)))
    .where(and(...conds))
    .orderBy(desc(transactions.bookedDate))
    .limit(Math.min(filter.limit ?? 200, 1000));
}

/** One of this book's bank lines, or null. */
export async function ownTransaction(id: string) {
  return first(
    await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.tenantId, tenantId()), eq(transactions.id, id)))
      .limit(1),
  );
}

/**
 * Whether a bill confirmed from this document may be posted against a bank line,
 * checked BEFORE anything is created.
 *
 * confirmAsBill creates the bill and then posts it, so a posting refused halfway
 * would leave a bill behind with the document still pending. Everything
 * postBillToTransaction would refuse is refused here first, plus one thing it
 * does not check: the amount. The bank line has to be one of the document's own
 * candidates, or the same amount as the bill to the cent. Returns the line, so
 * the caller can keep the category somebody already gave it.
 */
export async function postableTransaction(
  documentId: string,
  transactionId: string,
  bill: { total: number; issueDate: string },
) {
  const tx = await ownTransaction(transactionId);
  if (!tx) throw new Error("No such transaction in this book.");
  if (tx.amount >= 0) throw new Error("That transaction is money in, so it cannot pay a bill.");
  if (tx.bookedDate < bill.issueDate) {
    throw new Error("That payment left the account before the bill was issued, so it cannot be what paid it.");
  }
  const posted = first(
    await db
      .select({ id: billPayments.id })
      .from(billPayments)
      .where(and(eq(billPayments.tenantId, tenantId()), eq(billPayments.transactionId, transactionId)))
      .limit(1),
  );
  if (posted) throw new Error("That transaction is already posted to a bill.");

  const sameAmount = Math.abs(Math.abs(tx.amount) - bill.total) < 0.005;
  const offered = (await candidateTransactions(documentId)).some((c) => c.id === transactionId);
  if (!sameAmount && !offered) {
    throw new Error(
      `That payment is €${Math.abs(tx.amount).toFixed(2)} and the bill is €${bill.total.toFixed(2)}, ` +
        "and it is not one of this document's candidate payments. Nothing was created.",
    );
  }
  return tx;
}
