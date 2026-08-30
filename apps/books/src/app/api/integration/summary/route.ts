import { runInTenant } from "@cashish/core/db";
import { resolveApiKey } from "@/lib/auth";
import { can } from "@cashish/core/rbac";
import { buildIntegrationSummary } from "@/lib/integration";

export const dynamic = "force-dynamic";

// The integration surface over HTTP — one aggregate payload per tenant, for
// Lunar to pull.
//
// Authentication is an API key, not the old shared CASHISH_INTEGRATION_TOKEN
// env var. That token identified no tenant, so in a multi-tenant service it
// could not answer the only question that matters here: whose books? A key
// carries its tenant and its role, and a read-only key is enough for this.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const header = req.headers.get("authorization");
  const provided = header?.startsWith("Bearer ")
    ? header.slice(7)
    : url.searchParams.get("token");

  const credential = provided ? await resolveApiKey(provided) : null;
  if (!credential || !can(credential.role, "books:read")) {
    return Response.json(
      {
        error: "unauthorised",
        hint: "Send a cashish API key as `Authorization: Bearer ck_live_…`. Create one in Settings.",
      },
      { status: 401, headers: { "www-authenticate": "Bearer" } },
    );
  }

  const asOf = url.searchParams.get("asOf") ?? undefined;
  const summary = await runInTenant(credential, () => buildIntegrationSummary(asOf));
  return Response.json(summary, { headers: { "cache-control": "no-store" } });
}
