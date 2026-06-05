import { db, schema } from "@/db/client";
import { eq, inArray, sql } from "drizzle-orm";
import { uid } from "./id";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join, extname } from "path";

const { receipts } = schema;

// Blobs live on disk next to the DB (data/receipts/), not in SQLite — keeps the
// DB small and lets you browse/back-up receipts directly. Only metadata + a
// relative path is stored in the receipts table.
const RECEIPTS_DIR = join(process.cwd(), "data", "receipts");

function ensureDir() {
  if (!existsSync(RECEIPTS_DIR)) mkdirSync(RECEIPTS_DIR, { recursive: true });
}

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
  ensureDir();
  const id = uid();
  const ext = extname(file.name) || mimeExt(file.type);
  const rel = join("data", "receipts", `${id}${ext}`);
  writeFileSync(join(process.cwd(), rel), file.bytes);
  db.insert(receipts)
    .values({
      id,
      transactionId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.bytes.length,
      storagePath: rel,
    })
    .run();
  return id;
}

export function listReceiptsFor(transactionId: string) {
  return db.select().from(receipts).where(eq(receipts.transactionId, transactionId)).all();
}

// Map of transactionId -> count, for showing the paperclip badge in the ledger.
export function receiptCounts(transactionIds: string[]): Record<string, number> {
  if (transactionIds.length === 0) return {};
  const rows = db
    .select({ tx: receipts.transactionId, n: sql<number>`COUNT(*)` })
    .from(receipts)
    .where(inArray(receipts.transactionId, transactionIds))
    .groupBy(receipts.transactionId)
    .all();
  const out: Record<string, number> = {};
  for (const r of rows) out[r.tx] = Number(r.n);
  return out;
}

export function getReceipt(id: string) {
  const r = db.select().from(receipts).where(eq(receipts.id, id)).get();
  if (!r) return null;
  const abs = join(process.cwd(), r.storagePath);
  if (!existsSync(abs)) return { meta: r, bytes: null as Buffer | null };
  return { meta: r, bytes: readFileSync(abs) };
}

export function deleteReceipt(id: string) {
  const r = db.select().from(receipts).where(eq(receipts.id, id)).get();
  if (!r) return;
  const abs = join(process.cwd(), r.storagePath);
  try {
    if (existsSync(abs)) rmSync(abs);
  } catch {
    // best-effort; metadata removal still proceeds
  }
  db.delete(receipts).where(eq(receipts.id, id)).run();
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
