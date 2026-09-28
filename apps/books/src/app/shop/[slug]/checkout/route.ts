import { createTenantShopCheckout } from "@cashish/core/stripe";
import { withShop, resolveCart, checkoutMetadata } from "@/lib/shop";
import { appOrigin } from "@/lib/origin";

export const dynamic = "force-dynamic";

// The cart is the posted shop form itself: qty:<productId> per line. POST, not
// GET, because each call creates a Stripe Checkout Session.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const shopUrl = `${appOrigin(req)}/shop/${encodeURIComponent(slug)}`;
  const form = await req.formData();
  let url: string | null;
  try {
    url = await withShop(slug, async (shop) => {
      if (!shop.stripeSecretKey) return null;
      const cart = await resolveCart(form.entries());
      if (cart.length === 0) return `${shopUrl}?empty=1`;
      const session = await createTenantShopCheckout(shop.stripeSecretKey, {
        items: cart.map(({ product, quantity }) => ({
          name: product.name,
          description: product.description,
          unitAmount: product.grossPrice,
          quantity,
        })),
        currency: shop.currency,
        shipping: shop.shipping,
        collectAddress: cart.some(({ product }) => product.kind === "good"),
        successUrl: `${shopUrl}?paid=1`,
        cancelUrl: shopUrl,
        metadata: checkoutMetadata(),
      });
      return session.url;
    });
  } catch (e) {
    // Most often a revoked or wrong Stripe key on the tenant's side. The message
    // never reaches the visitor, but the log is how the tenant finds out.
    console.error(`shop checkout failed for ${slug}:`, (e as Error).message);
    return new Response("Checkout is unavailable right now.", { status: 502 });
  }
  if (!url) return new Response("Not found", { status: 404 });
  return Response.redirect(url, 303);
}
