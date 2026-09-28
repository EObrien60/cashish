import { listShopProducts } from "@/lib/shop";
import { withApiShop } from "@/lib/shop-api";
import { appOrigin } from "@/lib/origin";

export const dynamic = "force-dynamic";

// GET /api/shop/products — what the shop currently lists, priced incl. VAT.
export async function GET(req: Request) {
  return withApiShop(req, async (shop) => {
    const base = `${appOrigin(req)}/shop/${encodeURIComponent(shop.slug)}`;
    const products = (await listShopProducts()).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      kind: p.kind,
      price: p.grossPrice,
      currency: shop.currency,
      photoUrl: p.hasPhoto ? `${base}/img/${p.id}` : null,
    }));
    return Response.json(
      { shop: { name: shop.name, currency: shop.currency, shipping: shop.shipping }, products },
      { headers: { "cache-control": "no-store" } },
    );
  });
}
