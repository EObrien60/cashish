/**
 * The document write tools, and the query that finds what still needs paperwork.
 *
 * What these protect: an agent turning an uploaded invoice into books entries
 * can only do what a person confirming it on screen could do. It cannot post a
 * bill against a payment that doesn't match, cannot confirm one document twice,
 * cannot overwrite a bill's file, and cannot touch another business's rows.
 * Posting against a transaction that was already tagged keeps its category.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { and, eq } from "drizzle-orm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Role } from "@cashish/core/rbac";
import { db, schema } from "@cashish/core/db";
import { asTenant, makeTenant, closePool, seeded } from "./harness";
import { registerTools } from "../mcp/tools";
import { createVendor } from "../src/lib/vendors";
import { createBill, getBill, getBillFile } from "../src/lib/bills";
import { saveDocument, getDocument, linkToTransaction } from "../src/lib/documents";
import { saveReceipt } from "../src/lib/receipts";
import { uid } from "../src/lib/id";

let tenant: string;
let other: string;
before(async () => {
  tenant = (await makeTenant("mcp-docw")).id;
  other = (await makeTenant("mcp-docw-other")).id;
});
after(closePool);

async function call(tenantId: string, name: string, args: Record<string, unknown> = {}, role: Role = "owner") {
  return asTenant(
    tenantId,
    async () => {
      const server = new McpServer({ name: "cashish", version: "test" });
      registerTools(server, { role });
      const [a, b] = InMemoryTransport.createLinkedPair();
      await server.connect(a);
      const client = new Client({ name: "test", version: "0" });
      await client.connect(b);
      try {
        const res = (await client.callTool({ name, arguments: args })) as {
          content: { text: string }[];
          isError?: boolean;
        };
        const raw = res.content[0]?.text ?? "";
        let body: any = raw;
        try { body = JSON.parse(raw); } catch { /* an error message */ }
        return { isError: !!res.isError, body, raw };
      } finally {
        await client.close();
      }
    },
    role,
  );
}

const BILL = {
  kind: "bill", confidence: "high", counterparty: "Hosting Ltd", documentNumber: "H-1",
  issueDate: "2026-08-20", dueDate: null, currency: "EUR", net: 100, tax: 23, gross: 123,
  lines: [], notes: null,
};

/** A pending document with an extraction, as an upload would leave it. */
async function doc(tenantId: string, extraction: Record<string, unknown> = BILL, content = uid()) {
  return asTenant(tenantId, async () => {
    const id = await saveDocument({ name: "inv.pdf", type: "application/pdf", bytes: Buffer.from(`%PDF ${content}`) });
    await db.update(schema.documents)
      .set({ extraction: JSON.stringify(extraction), kind: String(extraction.kind) })
      .where(eq(schema.documents.id, id));
    return id;
  });
}

async function tx(tenantId: string, values: Partial<typeof schema.transactions.$inferInsert> = {}) {
  const id = uid();
  await asTenant(tenantId, () =>
    db.insert(schema.transactions).values({
      id, tenantId, bookedDate: "2026-08-25", amount: -123, description: "HOSTING LTD", importBatch: "t", ...values,
    }),
  );
  return id;
}

const confirmArgs = (documentId: string, extra: Record<string, unknown> = {}) => ({
  documentId, vendorName: "Hosting Ltd", number: "H-1", issueDate: "2026-08-20", net: 100, vatTotal: 23, ...extra,
});

/* --------------------------------------------------- confirm as a bill --- */

test("confirming a document creates a bill carrying its file and marks the document confirmed", async () => {
  const id = await doc(tenant);
  const r = await call(tenant, "cashish_confirm_document_as_bill", confirmArgs(id));
  assert.equal(r.isError, false, r.raw);
  const bill = await asTenant(tenant, () => getBill(r.body.billId));
  assert.equal(bill?.total, 123);
  assert.ok(await asTenant(tenant, () => getBillFile(r.body.billId)), "the invoice travels with the bill");
  assert.equal((await asTenant(tenant, () => getDocument(id)))?.status, "confirmed");
});

test("a document cannot be confirmed twice", async () => {
  const id = await doc(tenant);
  const first = await call(tenant, "cashish_confirm_document_as_bill", confirmArgs(id));
  assert.equal(first.isError, false, first.raw);
  const second = await call(tenant, "cashish_confirm_document_as_bill", confirmArgs(id));
  assert.equal(second.isError, true);
  const bills = await asTenant(tenant, () =>
    db.select().from(schema.bills).where(and(eq(schema.bills.tenantId, tenant), eq(schema.bills.number, "H-1"))),
  );
  assert.equal(bills.filter((b) => b.id === first.body.billId).length, 1);
});

test("posting against a tagged transaction keeps that transaction's category", async () => {
  const id = await doc(tenant, { ...BILL, documentNumber: "H-2" });
  const t = await tx(tenant, { categoryId: seeded(tenant, "cat-software") });
  const r = await call(tenant, "cashish_confirm_document_as_bill",
    confirmArgs(id, { number: "H-2", paidByTransactionId: t }));
  assert.equal(r.isError, false, r.raw);
  const bill = await asTenant(tenant, () => getBill(r.body.billId));
  assert.equal(bill?.categoryId, seeded(tenant, "cat-software"));
  assert.equal(bill?.status, "paid");
  assert.equal(bill?.payments[0]?.transactionId, t);
});

test("an explicit category wins over the transaction's", async () => {
  const id = await doc(tenant, { ...BILL, documentNumber: "H-3" });
  const t = await tx(tenant, { categoryId: seeded(tenant, "cat-software") });
  const r = await call(tenant, "cashish_confirm_document_as_bill",
    confirmArgs(id, { number: "H-3", paidByTransactionId: t, categoryId: seeded(tenant, "cat-office") }));
  assert.equal(r.isError, false, r.raw);
  assert.equal((await asTenant(tenant, () => getBill(r.body.billId)))?.categoryId, seeded(tenant, "cat-office"));
});

test("a payment of a different amount is refused, and no bill is left behind", async () => {
  const id = await doc(tenant, { ...BILL, documentNumber: "H-4" });
  const t = await tx(tenant, { amount: -999.99 });
  const before = await asTenant(tenant, () => db.select().from(schema.bills).where(eq(schema.bills.tenantId, tenant)));
  const r = await call(tenant, "cashish_confirm_document_as_bill",
    confirmArgs(id, { number: "H-4", paidByTransactionId: t }));
  assert.equal(r.isError, true);
  const afterRows = await asTenant(tenant, () => db.select().from(schema.bills).where(eq(schema.bills.tenantId, tenant)));
  assert.equal(afterRows.length, before.length);
  assert.equal((await asTenant(tenant, () => getDocument(id)))?.status, "pending");
});

test("a payment already posted to another bill is refused before anything is created", async () => {
  const t = await tx(tenant);
  const first = await call(tenant, "cashish_confirm_document_as_bill",
    confirmArgs(await doc(tenant, { ...BILL, documentNumber: "H-5" }), { number: "H-5", paidByTransactionId: t }));
  assert.equal(first.isError, false, first.raw);
  const before = await asTenant(tenant, () => db.select().from(schema.bills).where(eq(schema.bills.tenantId, tenant)));
  const second = await call(tenant, "cashish_confirm_document_as_bill",
    confirmArgs(await doc(tenant, { ...BILL, documentNumber: "H-6" }), { number: "H-6", paidByTransactionId: t }));
  assert.equal(second.isError, true);
  const afterRows = await asTenant(tenant, () => db.select().from(schema.bills).where(eq(schema.bills.tenantId, tenant)));
  assert.equal(afterRows.length, before.length);
});

test("another business's transaction cannot pay this one's bill", async () => {
  const id = await doc(tenant, { ...BILL, documentNumber: "H-7" });
  const theirs = await tx(other);
  const r = await call(tenant, "cashish_confirm_document_as_bill",
    confirmArgs(id, { number: "H-7", paidByTransactionId: theirs }));
  assert.equal(r.isError, true);
});

test("a viewer cannot confirm", async () => {
  const id = await doc(tenant);
  const r = await call(tenant, "cashish_confirm_document_as_bill", confirmArgs(id), "viewer");
  assert.equal(r.isError, true);
  assert.equal((await asTenant(tenant, () => getDocument(id)))?.status, "pending");
});

/* ----------------------------------------------------- link and reject --- */

test("linking a document to a transaction confirms it; another tenant's ids are refused", async () => {
  const id = await doc(tenant, { ...BILL, kind: "receipt" });
  const t = await tx(tenant);
  const theirs = await tx(other);
  const bad = await call(tenant, "cashish_link_document_to_transaction", { documentId: id, transactionId: theirs });
  assert.equal(bad.isError, true);
  const r = await call(tenant, "cashish_link_document_to_transaction", { documentId: id, transactionId: t });
  assert.equal(r.isError, false, r.raw);
  const d = await asTenant(tenant, () => getDocument(id));
  assert.equal(d?.status, "confirmed");
  assert.equal(d?.transactionId, t);
  const again = await call(tenant, "cashish_link_document_to_transaction", { documentId: id, transactionId: t });
  assert.equal(again.isError, true, "a confirmed document is not re-linked");
  const cross = await call(other, "cashish_link_document_to_transaction", { documentId: id, transactionId: theirs });
  assert.equal(cross.isError, true, "one tenant cannot link another's document");
});

test("rejecting a document; a viewer cannot", async () => {
  const id = await doc(tenant);
  assert.equal((await call(tenant, "cashish_reject_document", { documentId: id }, "viewer")).isError, true);
  const r = await call(tenant, "cashish_reject_document", { documentId: id });
  assert.equal(r.isError, false, r.raw);
  assert.equal((await asTenant(tenant, () => getDocument(id)))?.status, "rejected");
  assert.equal((await call(other, "cashish_reject_document", { documentId: await doc(tenant) })).isError, true);
});

/* ------------------------------------------------- attaching to a bill --- */

test("attaching a document's file to a bill that has none", async () => {
  const { vendor } = await asTenant(tenant, () => createVendor({ name: "Attach Co" }));
  const bill = await asTenant(tenant, () => createBill({ vendorId: vendor.id, issueDate: "2026-08-01", net: 10, vatTotal: 0 }));
  const id = await doc(tenant, BILL, "attach-me");
  const r = await call(tenant, "cashish_attach_bill_file", { billId: bill!.id, documentId: id });
  assert.equal(r.isError, false, r.raw);
  const file = await asTenant(tenant, () => getBillFile(bill!.id));
  assert.equal(file?.bytes?.toString(), "%PDF attach-me");
  const d = await asTenant(tenant, () => getDocument(id));
  assert.equal(d?.status, "confirmed");
  assert.equal(d?.billId, bill!.id);
});

test("a bill that already has a file is not overwritten", async () => {
  const { vendor } = await asTenant(tenant, () => createVendor({ name: "Has File Co" }));
  const bill = await asTenant(tenant, () => createBill({
    vendorId: vendor.id, issueDate: "2026-08-01", net: 10, vatTotal: 0,
    file: { name: "orig.pdf", type: "application/pdf", bytes: Buffer.from("%PDF original") },
  }));
  const id = await doc(tenant);
  const r = await call(tenant, "cashish_attach_bill_file", { billId: bill!.id, documentId: id });
  assert.equal(r.isError, true);
  assert.equal((await asTenant(tenant, () => getBillFile(bill!.id)))?.bytes?.toString(), "%PDF original");
  assert.equal((await asTenant(tenant, () => getDocument(id)))?.status, "pending");
});

test("a document whose file is gone cannot be attached", async () => {
  const { vendor } = await asTenant(tenant, () => createVendor({ name: "Gone Co" }));
  const bill = await asTenant(tenant, () => createBill({ vendorId: vendor.id, issueDate: "2026-08-01", net: 10, vatTotal: 0 }));
  const id = await doc(tenant);
  await asTenant(tenant, () => db.update(schema.documents).set({ storagePath: "tenants/nowhere/missing.pdf" }).where(eq(schema.documents.id, id)));
  const r = await call(tenant, "cashish_attach_bill_file", { billId: bill!.id, documentId: id });
  assert.equal(r.isError, true);
  assert.equal((await asTenant(tenant, () => getBill(bill!.id)))?.storagePath ?? "", "");
});

test("attaching across tenants is refused, and a viewer cannot attach", async () => {
  const { vendor } = await asTenant(other, () => createVendor({ name: "Their Co" }));
  const theirBill = await asTenant(other, () => createBill({ vendorId: vendor.id, issueDate: "2026-08-01", net: 10, vatTotal: 0 }));
  const mine = await doc(tenant);
  assert.equal((await call(tenant, "cashish_attach_bill_file", { billId: theirBill!.id, documentId: mine })).isError, true);
  assert.equal((await call(other, "cashish_attach_bill_file", { billId: theirBill!.id, documentId: mine })).isError, true);
  const { vendor: v2 } = await asTenant(tenant, () => createVendor({ name: "Viewer Co" }));
  const myBill = await asTenant(tenant, () => createBill({ vendorId: v2.id, issueDate: "2026-08-01", net: 10, vatTotal: 0 }));
  assert.equal((await call(tenant, "cashish_attach_bill_file", { billId: myBill!.id, documentId: mine }, "viewer")).isError, true);
});

/* ---------------------------------------- what still needs paperwork --- */

test("tagged outflows with no paperwork are listed; everything else is not", async () => {
  const t = await makeTenant("mcp-missing");
  const tid = t.id;
  const { vendor } = await asTenant(tid, () => createVendor({ name: "Missing Co" }));
  const cat = seeded(tid, "cat-software");
  const d = "2026-07-10";

  const categoryOnly = await tx(tid, { bookedDate: d, categoryId: cat });
  const vendorOnly = await tx(tid, { bookedDate: d, vendorId: vendor.id });
  const untagged = await tx(tid, { bookedDate: d });
  const inflow = await tx(tid, { bookedDate: d, amount: 50, categoryId: seeded(tid, "cat-sales") });
  const excluded = await tx(tid, { bookedDate: d, categoryId: cat, excluded: true });
  const withReceipt = await tx(tid, { bookedDate: d, categoryId: cat });
  const withDoc = await tx(tid, { bookedDate: d, categoryId: cat });
  const withBill = await tx(tid, { bookedDate: d, categoryId: cat, amount: -10 });
  const outOfRange = await tx(tid, { bookedDate: "2025-01-01", categoryId: cat });

  await asTenant(tid, async () => {
    await saveReceipt(withReceipt, { name: "r.pdf", type: "application/pdf", bytes: Buffer.from("%PDF r") });
    const id = await saveDocument({ name: "d.pdf", type: "application/pdf", bytes: Buffer.from("%PDF d") });
    await linkToTransaction(id, withDoc);
    await createBill({ vendorId: vendor.id, issueDate: "2026-07-01", net: 10, vatTotal: 0, paidByTransactionId: withBill });
  });

  const r = await call(tid, "cashish_transactions_missing_documents", { from: "2026-01-01", to: "2026-12-31" });
  assert.equal(r.isError, false, r.raw);
  const ids = new Set(r.body.map((x: { id: string }) => x.id));
  assert.ok(ids.has(categoryOnly), "category-only tagged outflow");
  assert.ok(ids.has(vendorOnly), "vendor-only tagged outflow");
  for (const [name, id] of Object.entries({ untagged, inflow, excluded, withReceipt, withDoc, withBill, outOfRange })) {
    assert.equal(ids.has(id), false, `${name} should not be listed`);
  }
  const row = r.body.find((x: { id: string }) => x.id === vendorOnly);
  assert.equal(row.vendorName, "Missing Co");
  assert.equal(r.body.find((x: { id: string }) => x.id === categoryOnly).categoryName.length > 0, true);

  const theirs = await call(other, "cashish_transactions_missing_documents", { from: "2026-01-01", to: "2026-12-31" });
  assert.equal(theirs.body.some((x: { id: string }) => ids.has(x.id)), false, "never another tenant's rows");
});
