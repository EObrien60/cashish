import { put, del, get } from "@vercel/blob";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";

// ---------------------------------------------------------------------------
// Where receipt blobs live.
//
// Production is Vercel Blob (private): Vercel has no writable filesystem, so
// the previous writeFileSync approach cannot work there at all.
//
// Local dev and tests fall back to disk when BLOB_READ_WRITE_TOKEN is absent,
// so `npm run dev` and the test suite work offline. This is a deliberate second
// backend, and it is a far smaller risk than the two-SQL-dialect option that was
// rejected in the design: there are no query semantics here, only put/get/delete
// of opaque bytes. Nothing about a stored receipt's *meaning* differs between them.
// ---------------------------------------------------------------------------

const hasBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;
const LOCAL_ROOT = join(process.env.CASHISH_DATA_DIR ?? process.cwd(), "data", "blobs");

export type StoredBlob = { pathname: string };

export async function putBlob(
  pathname: string,
  bytes: Buffer,
  contentType: string,
): Promise<StoredBlob> {
  if (hasBlob()) {
    const result = await put(pathname, bytes, {
      // Private, not public: a receipt is a financial document and a public blob
      // URL is world-readable to anyone who learns it.
      access: "private",
      contentType,
      // The pathname already carries a uid; adding a random suffix would make the
      // stored path unpredictable and break the metadata row that points at it.
      addRandomSuffix: false,
    });
    return { pathname: result.pathname };
  }
  const abs = join(LOCAL_ROOT, pathname);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, bytes);
  return { pathname };
}

export async function getBlob(pathname: string): Promise<Buffer | null> {
  if (hasBlob()) {
    try {
      const result = await get(pathname, { access: "private" });
      if (!result) return null;
      return Buffer.from(await new Response(result.stream).arrayBuffer());
    } catch {
      return null;
    }
  }
  const abs = join(LOCAL_ROOT, pathname);
  return existsSync(abs) ? readFileSync(abs) : null;
}

export async function deleteBlob(pathname: string): Promise<void> {
  if (hasBlob()) {
    try {
      await del(pathname);
    } catch {
      // Best-effort: the metadata row is removed either way, and an orphaned
      // blob costs storage but never shows a wrong number in the books.
    }
    return;
  }
  const abs = join(LOCAL_ROOT, pathname);
  try {
    if (existsSync(abs)) rmSync(abs);
  } catch {
    // as above
  }
}
