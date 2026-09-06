/**
 * Documents.
 *
 * The property worth protecting: a document changes nothing until somebody
 * confirms it. An invoice read wrongly and posted silently is a wrong number in
 * a VAT return that nobody goes looking for, so the storage, the extraction and
 * the books are three separate steps and only the last one is destructive.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import { asTenant, makeTenant, closePool } from "./harness";
import { db, schema } from "@cashish/core/db";
import { uid } from "../src/lib/id";
import {
  saveDocument,
  listDocuments,
  getDocumentFile,
  confirmAsBill,
  candidateTransactions,
  rejectDocument,
  deleteDocument,
  linkToTransaction,
} from "../src/lib/documents";

let tenant: string;
before(async () => { tenant = (await makeTenant("documents")).id; });
after(closePool);

const reset = () => asTenant(tenant, async () => {
  await db.delete(schema.documents).where(eq(schema.documents.tenantId, tenant));
  await db.delete(schema.billPayments).where(eq(schema.billPayments.tenantId, tenant));
  await db.delete(schema.bills).where(eq(schema.bills.tenantId, tenant));
  await db.delete(schema.vendors).where(eq(schema.vendors.tenantId, tenant));
  await db.delete(schema.transactions).where(eq(schema.transactions.tenantId, tenant));
});

const upload = (name = "invoice.pdf") =>
  asTenant(tenant, () =>
    saveDocument({ name, type: "application/pdf", bytes: Buffer.from("%PDF-1.4 pretend invoice") }),
  );

/** Stands in for the model, so the rest can be tested without one. */
const setExtraction = (id: string, extraction: Record<string, unknown>) =>
  asTenant(tenant, async () => {
    await db
      .update(schema.documents)
      .set({ extraction: JSON.stringify(extraction), kind: String(extraction.kind) })
      .where(eq(schema.documents.id, id));
  });

const BILL = {
  kind: "bill",
  confidence: "high",
  counterparty: "TD SYNNEX Ireland Limited",
  documentNumber: "INV-8282895150",
  issueDate: "2026-08-20",
  dueDate: "2026-09-19",
  currency: "EUR",
  net: 3212.65,
  tax: 737.91,
  gross: 3950.56,
  lines: [],
  notes: null,
};

test("an uploaded document is stored and comes back byte for byte", async () => {
  await reset();
  const id = await upload();
  const file = await asTenant(tenant, () => getDocumentFile(id));
  assert.ok(file);
  assert.equal(file.name, "invoice.pdf");
  assert.equal(file.bytes.toString(), "%PDF-1.4 pretend invoice");

  const [row] = await asTenant(tenant, () => listDocuments());
  assert.equal(row.status, "pending", "it waits for a person");
  assert.equal(row.extraction, null, "and nothing has been read yet");
});

test("a read document still writes nothing to the books", async () => {
  const [doc] = await asTenant(tenant, () => listDocuments());
  await setExtraction(doc.id, BILL);

  const [row] = await asTenant(tenant, () => listDocuments());
  assert.equal(row.status, "pending");
  assert.equal(row.extraction?.counterparty, "TD SYNNEX Ireland Limited");

  const bills = await asTenant(tenant, () =>
    db.select().from(schema.bills).where(eq(schema.bills.tenantId, tenant)),
  );
  assert.equal(bills.length, 0, "reading is not posting");
});

test("confirming creates the bill, the supplier, and keeps the document with it", async () => {
  const [doc] = await asTenant(tenant, () => listDocuments());
  const { billId } = await asTenant(tenant, () =>
    confirmAsBill(doc.id, {
      vendorName: "TD SYNNEX Ireland Limited",
      number: "INV-8282895150",
      issueDate: "2026-08-20",
      dueDate: "2026-09-19",
      net: 3212.65,
      vatTotal: 737.91,
    }),
  );

  const [bill] = await asTenant(tenant, () =>
    db.select().from(schema.bills).where(eq(schema.bills.id, billId)),
  );
  assert.equal(bill.total, 3950.56, "net plus VAT, derived rather than taken on trust");

  const vendors = await asTenant(tenant, () =>
    db.select().from(schema.vendors).where(eq(schema.vendors.tenantId, tenant)),
  );
  assert.equal(vendors.length, 1);
  assert.equal(vendors[0].name, "TD SYNNEX Ireland Limited");

  const [row] = await asTenant(tenant, () => listDocuments());
  assert.equal(row.status, "confirmed");
  assert.equal(row.billId, billId);
  assert.ok(row.extraction, "what was read is kept, so a figure can be explained later");
});

test("what the person corrected is what is saved, not what was read", async () => {
  await reset();
  const id = await upload("corrected.pdf");
  await setExtraction(id, { ...BILL, net: 9999, tax: 1 });

  const { billId } = await asTenant(tenant, () =>
    confirmAsBill(id, {
      vendorName: "TD SYNNEX Ireland Limited",
      issueDate: "2026-08-20",
      net: 3212.65,
      vatTotal: 737.91,
    }),
  );
  const [bill] = await asTenant(tenant, () =>
    db.select().from(schema.bills).where(eq(schema.bills.id, billId)),
  );
  assert.equal(bill.net, 3212.65, "the correction wins");

  const [row] = await asTenant(tenant, () => listDocuments());
  assert.equal(row.extraction?.net, 9999, "and the misreading is still on record");
});

test("a second invoice from the same supplier does not create a second supplier", async () => {
  const id = await upload("second.pdf");
  await setExtraction(id, BILL);
  await asTenant(tenant, () =>
    confirmAsBill(id, {
      vendorName: "TD SYNNEX Ireland Limited",
      issueDate: "2026-09-20",
      net: 100,
      vatTotal: 23,
    }),
  );
  const vendors = await asTenant(tenant, () =>
    db.select().from(schema.vendors).where(eq(schema.vendors.tenantId, tenant)),
  );
  assert.equal(vendors.length, 1);
});

test("the payment it belongs to is offered, not assumed", async () => {
  await reset();
  const id = await upload();
  await setExtraction(id, BILL);

  await asTenant(tenant, async () => {
    await db.insert(schema.transactions).values([
      // Same amount, a few days later — the one.
      { id: uid(), tenantId: tenant, bookedDate: "2026-08-25", amount: -3950.56, description: "TD SYNNEX Ireland Limited", importBatch: "t" },
      // Same amount but months away.
      { id: uid(), tenantId: tenant, bookedDate: "2026-02-25", amount: -3950.56, description: "Something else", importBatch: "t" },
      // Near the date but a different amount.
      { id: uid(), tenantId: tenant, bookedDate: "2026-08-24", amount: -12.5, description: "Coffee", importBatch: "t" },
    ]);
  });

  const found = await asTenant(tenant, () => candidateTransactions(id));
  assert.equal(found.length, 1, "same amount, near the date, and nothing else");
  assert.equal(found[0].date, "2026-08-25");

  // Offered only: until it is attached, the document is still waiting.
  const [before] = await asTenant(tenant, () => listDocuments());
  assert.equal(before.status, "pending");

  await asTenant(tenant, () => linkToTransaction(id, found[0].id));
  const [after] = await asTenant(tenant, () => listDocuments());
  assert.equal(after.status, "confirmed");
  assert.equal(after.transactionId, found[0].id);
});

test("a document with no total offers no payments rather than guessing", async () => {
  await reset();
  const id = await upload();
  await setExtraction(id, { ...BILL, gross: null });
  assert.deepEqual(await asTenant(tenant, () => candidateTransactions(id)), []);
});

test("rejecting keeps the file; deleting removes it", async () => {
  await reset();
  const keep = await upload("keep.pdf");
  const gone = await upload("gone.pdf");

  await asTenant(tenant, () => rejectDocument(keep));
  const [rejected] = await asTenant(tenant, () => listDocuments("rejected"));
  assert.equal(rejected.fileName, "keep.pdf");
  assert.ok(await asTenant(tenant, () => getDocumentFile(keep)), "still there to look at");

  await asTenant(tenant, () => deleteDocument(gone));
  assert.equal(await asTenant(tenant, () => getDocumentFile(gone)), null);
  const remaining = await asTenant(tenant, () => listDocuments());
  assert.equal(remaining.length, 1);
});

test("documents belong to one book", async () => {
  const other = (await makeTenant("documents-other")).id;
  assert.equal((await asTenant(other, () => listDocuments())).length, 0);
});
