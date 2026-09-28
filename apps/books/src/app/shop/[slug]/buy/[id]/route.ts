import { createTenantShopCheckout } from "@cashish/core/stripe";
import { withShop, getShopProduct } from "@/lib/shop";
import { appOrigin } from "@/lib/origin";

export const dynamic = "force-dynamic";

// POST, not GET: each call creates a Stripe Checkout Session, and a crawler or
// link prefetch following a GET would create them for nobody.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const shopUrl = `${appOrigin(req)}/shop/${encodeURIComponent(slug)}`;
  let url: string | null;
  try {
    url = await withShop(slug, async (shop) => {
      const p = await getShopProduct(id);
      if (!p || !shop.stripeSecretKey || p.grossPrice <= 0) return null;
      return createTenantShopCheckout(shop.stripeSecretKey, {
        unitAmount: p.grossPrice,
        currency: shop.currency,
        name: p.name,
        description: p.description,
        shipping: shop.shipping,
        collectAddress: p.kind === "good",
        successUrl: `${shopUrl}?paid=1`,
        cancelUrl: shopUrl,
      });
    });
  } catch {
    // Most often a revoked or wrong Stripe key on the tenant's side.
    return new Response("Checkout is unavailable right now.", { status: 502 });
  }
  if (!url) return new Response("Not found", { status: 404 });
  return Response.redirect(url, 303);
}
