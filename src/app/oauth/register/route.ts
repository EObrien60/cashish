import { registerClient } from "@/lib/oauth";

export const dynamic = "force-dynamic";

// RFC 7591 dynamic client registration, open by design: an MCP client cannot be
// pre-registered by hand if it is to be added from someone else's browser. What
// registration grants is only the ability to *ask* — no books are reachable
// until a signed-in owner approves the consent screen at /oauth/authorize.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_client_metadata" }, { status: 400 });
  }
  const input = (body ?? {}) as Record<string, unknown>;
  const uris = Array.isArray(input.redirect_uris)
    ? input.redirect_uris.filter((u): u is string => typeof u === "string")
    : [];
  if (uris.length === 0) {
    return Response.json(
      { error: "invalid_redirect_uri", error_description: "redirect_uris is required" },
      { status: 400 },
    );
  }
  // Every redirect target must be https, or localhost for a native/dev client.
  for (const uri of uris) {
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      return Response.json(
        { error: "invalid_redirect_uri", error_description: `not a URL: ${uri}` },
        { status: 400 },
      );
    }
    const localhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol !== "https:" && !localhost) {
      return Response.json(
        {
          error: "invalid_redirect_uri",
          error_description: `redirect_uri must be https (or localhost): ${uri}`,
        },
        { status: 400 },
      );
    }
  }

  const method = typeof input.token_endpoint_auth_method === "string"
    ? input.token_endpoint_auth_method
    : "none";
  const client = await registerClient({
    redirectUris: uris,
    name: typeof input.client_name === "string" ? input.client_name : "Unnamed client",
    confidential: method !== "none",
  });

  return Response.json(
    {
      client_id: client.clientId,
      ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: client.clientSecret ? "client_secret_post" : "none",
    },
    { status: 201 },
  );
}
