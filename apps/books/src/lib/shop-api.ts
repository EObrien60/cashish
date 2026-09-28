import { runInTenant } from "@cashish/core/db";
import { can } from "@cashish/core/rbac";
import { resolveCredential, unauthorised } from "./mcp-auth";
import { currentShop, type Shop } from "./shop";

// ---------------------------------------------------------------------------
// The quickshop API: the same shop as /shop/<slug>, for a tenant's own app.
//
// Authenticated with a cashish API key or OAuth token, which names the tenant —
// there is no slug in the URL. books:read is enough: nothing here writes the
// books, and checkout only creates a session in the tenant's own Stripe.
// The shop toggle still applies, so switching the shop off closes both doors.
// ---------------------------------------------------------------------------

export const apiError = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  Response.json({ error, ...extra }, { status, headers: { "cache-control": "no-store" } });

export async function withApiShop(
  req: Request,
  fn: (shop: Shop) => Promise<Response>,
): Promise<Response> {
  const credential = await resolveCredential(req);
  if (!credential || !can(credential.role, "books:read")) return unauthorised(req);
  return runInTenant(credential, async () => {
    const shop = await currentShop();
    if (!shop) return apiError(404, "shop_disabled", { hint: "Turn the shop on in Settings." });
    return fn(shop);
  });
}
