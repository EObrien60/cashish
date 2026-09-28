import { createTenantShopCheckout } from "@cashish/core/stripe";
import { resolveCart, checkoutMetadata, MAX_QTY } from "@/lib/shop";
import { withApiShop, apiError } from "@/lib/shop-api";

export const dynamic = "force-dynamic";

const isWebUrl = (v: unknown) => {
  try {
    return typeof v === "string" && ["https:", "http:"].includes(new URL(v).protocol);
  } catch {
    return false;
  }
};

/**
 * POST /api/shop/checkout
 * { items: [{ id, quantity }], successUrl, cancelUrl, reference? } → { sessionId, url }
 *
 * Unlike the web form, a bad line is an error rather than silently dropped: an
 * app that asked for three items must not be handed a checkout for two.
 */
export async function POST(req: Request) {
  return withApiShop(req, async (shop) => {
    if (!shop.stripeSecretKey) return apiError(409, "stripe_not_configured");
    const body = await req.json().catch(() => null);
    const items: unknown = body?.items;
    if (!Array.isArray(items) || items.length === 0) {
      return apiError(400, "invalid_request", { hint: "items: [{ id, quantity }] is required." });
    }
    if (!isWebUrl(body.successUrl) || !isWebUrl(body.cancelUrl)) {
      return apiError(400, "invalid_request", { hint: "successUrl and cancelUrl must be http(s) URLs." });
    }
    const reference = body.reference == null ? undefined : String(body.reference).slice(0, 500);

    const ids = items.map((i) => String(i?.id ?? ""));
    if (new Set(ids).size !== ids.length) {
      return apiError(400, "invalid_request", { hint: "Each product id may appear once." });
    }
    const cart = await resolveCart(items.map((i) => [`qty:${i?.id}`, i?.quantity]));
    const accepted = new Set(cart.map((l) => l.product.id));
    const rejected = ids.filter((id) => !accepted.has(id));
    if (rejected.length > 0) {
      return apiError(400, "invalid_items", {
        ids: rejected,
        hint: `Each id must be a listed product, quantity a whole number 1–${MAX_QTY}.`,
      });
    }

    try {
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
        successUrl: body.successUrl,
        cancelUrl: body.cancelUrl,
        metadata: checkoutMetadata(reference),
      });
      return Response.json({ sessionId: session.id, url: session.url }, { status: 201 });
    } catch (e) {
      console.error(`shop api checkout failed for ${shop.slug}:`, (e as Error).message);
      return apiError(502, "stripe_error", { message: (e as Error).message });
    }
  });
}
