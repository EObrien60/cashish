import { boot } from "@/lib/boot";
import { buildIntegrationSummary, integrationTokenMatches } from "@/lib/integration";

export const dynamic = "force-dynamic";

// The integration surface over HTTP, for when cashish is running.
//
// Closed unless CASHISH_INTEGRATION_TOKEN is set and matches: this is a local
// accounting app, and an unguarded endpoint returning who owes what is not
// something to leave lying around. The desktop app can use the file export
// instead (npm run export:integration).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const header = req.headers.get("authorization");
  const provided = header?.startsWith("Bearer ")
    ? header.slice(7)
    : url.searchParams.get("token");

  if (!integrationTokenMatches(provided)) {
    return Response.json(
      {
        error: "unauthorised",
        hint: "Set CASHISH_INTEGRATION_TOKEN and send it as `Authorization: Bearer <token>`.",
      },
      { status: 401 },
    );
  }

  boot();
  const asOf = url.searchParams.get("asOf") ?? undefined;
  return Response.json(buildIntegrationSummary(asOf), {
    headers: { "cache-control": "no-store" },
  });
}
