import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { generateObject } from "ai";
import { z } from "zod";
import { extname } from "node:path";
import { db, first, schema, tenantId } from "@cashish/core/db";
import { REPORT_MODEL, aiIsConfigured, describeFailure, gatewayOptions, type AiResult } from "./ai";
import { putBlob, getBlob, deleteBlob } from "./storage";
import { round2, addDays } from "./format";
import { uid } from "./id";
import { notExcluded } from "./transactions";

const { documents, transactions } = schema;

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
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.bytes.length,
    storagePath: pathname,
    status: "pending",
  });
  return id;
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

  return rows.map((d) => ({
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
  }));
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
