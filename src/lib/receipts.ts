import { db, schema } from "@/db/client";
import { tenantId } from "@/db/context";
import { and, eq, inArray, sql } from "drizzle-orm";
import { extname } from "node:path";
import { uid } from "./id";
import { putBlob, getBlob, deleteBlob } from "./storage";

const { receipts } = schema;

// Receipt metadata lives in Postgres; the bytes live in blob storage (see
// storage.ts). `storage_path` holds the blob pathname, namespaced per tenant so
// one tenant's key can never address another's file.

const ofTenant = () => eq(receipts.tenantId, tenantId());

export const ALLOWED_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "application/pdf",
];

export async function saveReceipt(
  transactionId: string,
  file: { name: string; type: string; bytes: Buffer },
) {
  const tid = tenantId();
  const id = uid();
  const ext = extname(file.name) || mimeExt(file.type);
  const pathname = `tenants/${tid}/receipts/${id}${ext}`;
  const stored = await putBlob(
    pathname,
    file.bytes,
    file.type || "application/octet-stream",
  );
  await db.insert(receipts).values({
    id,
    tenantId: tid,
    transactionId,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.bytes.length,
    storagePath: stored.pathname,
  });
  return id;
}

export async function listReceiptsFor(transactionId: string) {
  return db
    .select()
    .from(receipts)
    .where(and(ofTenant(), eq(receipts.transactionId, transactionId)));
}

// Map of transactionId -> count, for showing the paperclip badge in the ledger.
export async function receiptCounts(
  transactionIds: string[],
): Promise<Record<string, number>> {
  if (transactionIds.length === 0) return {};
  const rows = await db
    .select({ tx: receipts.transactionId, n: sql<number>`COUNT(*)` })
    .from(receipts)
    .where(and(ofTenant(), inArray(receipts.transactionId, transactionIds)))
    .groupBy(receipts.transactionId);
  const out: Record<string, number> = {};
  // count() comes back from Postgres as bigint, which node-postgres hands over
  // as a string — Number() or the badge renders "12" for one receipt plus two.
  for (const r of rows) out[r.tx] = Number(r.n);
  return out;
}

export async function getReceipt(id: string) {
  const [meta] = await db
    .select()
    .from(receipts)
    .where(and(ofTenant(), eq(receipts.id, id)))
    .limit(1);
  if (!meta) return null;
  return { meta, bytes: await getBlob(meta.storagePath) };
}

export async function deleteReceipt(id: string) {
  const [meta] = await db
    .select()
    .from(receipts)
    .where(and(ofTenant(), eq(receipts.id, id)))
    .limit(1);
  if (!meta) return;
  await deleteBlob(meta.storagePath);
  await db.delete(receipts).where(and(ofTenant(), eq(receipts.id, id)));
}

function mimeExt(mime: string): string {
  switch (mime) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "application/pdf":
      return ".pdf";
    default:
      return "";
  }
}
