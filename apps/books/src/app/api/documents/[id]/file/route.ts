import { withTenant } from "@/lib/request-context";
import { getDocumentFile } from "@/lib/documents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Streamed through the app, like receipts and contracts: the blob store is
// private, and a document is somebody's invoice.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenant(async () => {
    const { id } = await params;
    const doc = await getDocumentFile(id);
    if (!doc) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(doc.bytes), {
      headers: {
        "Content-Type": doc.mime || "application/octet-stream",
        "Content-Disposition": `inline; filename="${doc.name.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  });
}
