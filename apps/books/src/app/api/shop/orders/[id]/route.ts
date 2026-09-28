import { tenantId } from "@cashish/core/db";
import { getTenantShopOrder } from "@cashish/core/stripe";
import { withApiShop, apiError } from "@/lib/shop-api";

export const dynamic = "force-dynamic";

/**
 * GET /api/shop/orders/<sessionId> — is it paid, and what was bought.
 *
 * Read live from the tenant's Stripe; cashish stores no orders. A session this
 * tenant's shop did not create is a 404, even if the Stripe key can see it.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withApiShop(req, async (shop) => {
    if (!shop.stripeSecretKey) return apiError(409, "stripe_not_configured");
    if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return apiError(404, "not_found");
    let order;
    try {
      order = await getTenantShopOrder(shop.stripeSecretKey, id);
    } catch (e) {
      const err = e as { statusCode?: number; message: string };
      if (err.statusCode === 404) return apiError(404, "not_found");
      console.error(`shop api order lookup failed for ${shop.slug}:`, err.message);
      return apiError(502, "stripe_error", { message: err.message });
    }
    if (order.metadata.cashish_tenant !== tenantId()) return apiError(404, "not_found");
    const { metadata, ...rest } = order;
    return Response.json(
      { ...rest, reference: metadata.reference ?? null },
      { headers: { "cache-control": "no-store" } },
    );
  });
}
