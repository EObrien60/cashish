/**
 * The documents, vendors and bills MCP tools.
 *
 * What these protect: an agent can put a supplier's invoice into the documents
 * inbox and read back what it became, without ever being able to write to the
 * books from here. Uploading is a proposal (books:import, the same as the UI);
 * the same file uploaded twice is one document; and nothing leaks a storage
 * path or another tenant's rows.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Role } from "@cashish/core/rbac";
import { db, schema } from "@cashish/core/db";
import { asTenant, makeTenant, closePool } from "./harness";
import { registerTools } from "../mcp/tools";
import { createVendor } from "../src/lib/vendors";
import { createBill } from "../src/lib/bills";

let tenant: string;
let other: string;
before(async () => {
  tenant = (await makeTenant("mcp-docs")).id;
  other = (await makeTenant("mcp-docs-other")).id;
});
after(closePool);

/** Calls one tool as a tenant and role, and returns its parsed result. */
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
        try { body = JSON.parse(raw); } catch { /* an error message, not JSON */ }
        return { isError: !!res.isError, body, raw };
      } finally {
        await client.close();
      }
    },
    role,
  );
}

const pdf = (s: string) => Buffer.from(`%PDF-1.4 ${s}`).toString("base64");
const docsOf = (tenantId: string) =>
  asTenant(tenantId, () => db.select().from(schema.documents).where(eq(schema.documents.tenantId, tenantId)));

test("upload stores a pending document and says it was not a duplicate", async () => {
  const r = await call(tenant, "cashish_upload_document", {
    fileName: "inv-1.pdf", mimeType: "application/pdf", base64: pdf("one"),
  });
  assert.equal(r.isError, false, r.raw);
  assert.ok(r.body.id);
  assert.equal(r.body.deduped, false);
  assert.equal(r.body.status, "pending");
  assert.equal("storagePath" in r.body, false, "never expose where the file lives");
});

test("the same bytes uploaded twice are one document", async () => {
  const args = { fileName: "inv-2.pdf", mimeType: "application/pdf", base64: pdf("two") };
  const first = await call(tenant, "cashish_upload_document", args);
  const second = await call(tenant, "cashish_upload_document", { ...args, fileName: "renamed.pdf" });
  assert.equal(second.body.deduped, true);
  assert.equal(second.body.id, first.body.id);
  const rows = (await docsOf(tenant)).filter((d) => d.id === first.body.id);
  assert.equal(rows.length, 1);
  assert.match(rows[0].sha256 ?? "", /^[0-9a-f]{64}$/);
});

test("dedupe is per tenant: another business uploading the same file gets its own", async () => {
  const args = { fileName: "shared.pdf", mimeType: "application/pdf", base64: pdf("shared") };
  const mine = await call(tenant, "cashish_upload_document", args);
  const theirs = await call(other, "cashish_upload_document", args);
  assert.equal(theirs.body.deduped, false);
  assert.notEqual(theirs.body.id, mine.body.id);
  const peek = await call(other, "cashish_document", { id: mine.body.id });
  assert.equal(peek.isError, true, "one tenant cannot read another's document");
});

test("a file over 10 MB is refused and nothing is stored", async () => {
  const before = (await docsOf(tenant)).length;
  const big = Buffer.alloc(10 * 1024 * 1024 + 1, 1).toString("base64");
  const r = await call(tenant, "cashish_upload_document", { fileName: "big.pdf", mimeType: "application/pdf", base64: big });
  assert.equal(r.isError, true);
  assert.equal((await docsOf(tenant)).length, before);
});

test("a type that cannot be an invoice is refused", async () => {
  const r = await call(tenant, "cashish_upload_document", {
    fileName: "x.html", mimeType: "text/html", base64: Buffer.from("<b>hi</b>").toString("base64"),
  });
  assert.equal(r.isError, true);
});

test("a viewer can read documents but cannot upload one", async () => {
  const r = await call(tenant, "cashish_upload_document",
    { fileName: "v.pdf", mimeType: "application/pdf", base64: pdf("viewer") }, "viewer");
  assert.equal(r.isError, true);
  const list = await call(tenant, "cashish_documents", {}, "viewer");
  assert.equal(list.isError, false, list.raw);
});

test("documents list filters by status, and one document carries its candidates", async () => {
  const up = await call(tenant, "cashish_upload_document", { fileName: "s.pdf", mimeType: "application/pdf", base64: pdf("status") });
  const pending = await call(tenant, "cashish_documents", { status: "pending" });
  assert.ok(pending.body.some((d: { id: string }) => d.id === up.body.id));
  const confirmed = await call(tenant, "cashish_documents", { status: "confirmed" });
  assert.equal(confirmed.body.some((d: { id: string }) => d.id === up.body.id), false);

  const one = await call(tenant, "cashish_document", { id: up.body.id });
  assert.equal(one.isError, false, one.raw);
  assert.ok(Array.isArray(one.body.candidateTransactions));
  assert.equal("storagePath" in one.body, false);
});

test("vendors can be searched", async () => {
  await asTenant(tenant, () => createVendor({ name: "TD SYNNEX Ireland Limited" }));
  const r = await call(tenant, "cashish_vendors", { search: "synnex" });
  assert.equal(r.isError, false, r.raw);
  assert.ok(r.body.some((v: { name: string }) => v.name === "TD SYNNEX Ireland Limited"));
});

test("bills say whether they have a file, never where it is", async () => {
  const { vendor } = await asTenant(tenant, () => createVendor({ name: "Bill Co" }));
  const withFile = await asTenant(tenant, () =>
    createBill({
      vendorId: vendor.id, issueDate: "2026-09-01", net: 100, vatTotal: 23,
      file: { name: "b.pdf", type: "application/pdf", bytes: Buffer.from("%PDF bill") },
    }),
  );
  const without = await asTenant(tenant, () =>
    createBill({ vendorId: vendor.id, issueDate: "2026-09-02", net: 50, vatTotal: 0 }),
  );

  const list = await call(tenant, "cashish_bills", { vendorId: vendor.id });
  assert.equal(list.isError, false, list.raw);
  const byId = new Map(list.body.map((b: { id: string }) => [b.id, b]));
  assert.equal((byId.get(withFile!.id) as { hasFile: boolean }).hasFile, true);
  assert.equal((byId.get(without!.id) as { hasFile: boolean }).hasFile, false);
  assert.equal(list.raw.includes("storagePath") || list.raw.includes("storage_path"), false);

  const missing = await call(tenant, "cashish_bills", { vendorId: vendor.id, missingFile: true });
  assert.deepEqual(missing.body.map((b: { id: string }) => b.id), [without!.id]);

  const one = await call(tenant, "cashish_bill", { id: withFile!.id });
  assert.equal(one.body.hasFile, true);
  assert.equal(one.raw.includes("storagePath") || one.raw.includes("storage_path"), false);

  const cross = await call(other, "cashish_bill", { id: withFile!.id });
  assert.equal(cross.isError, true, "one tenant cannot read another's bill");
});
