import { extname } from "node:path";
import { withShop, getShopProduct, PHOTO_MIME } from "@/lib/shop";
import { getBlob } from "@/lib/storage";

export const dynamic = "force-dynamic";

// A product photo, served only while the shop is on and the product is listed.
// The blob store is private; this route is the only public way to a photo.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const res = await withShop(slug, async () => {
    const p = await getShopProduct(id);
    if (!p?.photoPath) return null;
    const bytes = await getBlob(p.photoPath);
    if (!bytes) return null;
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": PHOTO_MIME[extname(p.photoPath)] ?? "application/octet-stream",
        // Short: hiding a product should take its photo down within minutes.
        "Cache-Control": "public, max-age=300",
      },
    });
  });
  return res ?? new Response("Not found", { status: 404 });
}
