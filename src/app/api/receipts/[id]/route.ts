import { boot } from "@/lib/boot";
import { getReceipt } from "@/lib/receipts";

export const dynamic = "force-dynamic";

// Streams a receipt file inline (so images/PDFs preview in the browser).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  boot();
  const { id } = await params;
  const r = getReceipt(id);
  if (!r || !r.bytes) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(new Uint8Array(r.bytes), {
    headers: {
      "Content-Type": r.meta.mimeType || "application/octet-stream",
      "Content-Disposition": `inline; filename="${r.meta.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
