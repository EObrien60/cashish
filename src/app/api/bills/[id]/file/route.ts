import { withTenant } from "@/lib/request-context";
import { getBillFile } from "@/lib/bills";

export const dynamic = "force-dynamic";

/**
 * Serves a bill's uploaded document to a signed-in member.
 *
 * Behind the session gate on purpose: the blob store is private, so this route
 * is the only way to read one, and it will only ever hand back a document
 * belonging to the caller's own tenant.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withTenant(async () => {
    const file = await getBillFile(id);
    if (!file) return new Response("Not found", { status: 404 });
    if (!file.bytes) {
      return new Response("The document is no longer in storage.", { status: 410 });
    }
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "content-type": file.meta.mimeType || "application/octet-stream",
        // inline: a bill is something you glance at, not something you download.
        "content-disposition": `inline; filename="${(file.meta.fileName || "bill").replace(/"/g, "")}"`,
        "cache-control": "private, no-store",
      },
    });
  });
}
