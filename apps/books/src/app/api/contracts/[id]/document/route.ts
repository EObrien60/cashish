import { withTenant } from "@/lib/request-context";
import { getDocument } from "@/lib/contracts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The signed contract, streamed through the app because the blob store is
// private — the same reasoning as receipts.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenant(async () => {
    const { id } = await params;
    const doc = await getDocument(id);
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
