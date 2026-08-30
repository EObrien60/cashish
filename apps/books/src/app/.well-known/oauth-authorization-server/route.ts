import { appOrigin } from "@/lib/origin";

export const dynamic = "force-dynamic";

// RFC 8414. Advertises only what this server actually implements: the
// authorization-code grant with mandatory S256 PKCE, and refresh. No implicit
// grant, no plain PKCE, no client_credentials — OAuth 2.1 drops the first two,
// and the third has no meaning here because every token belongs to a person.
export async function GET(request: Request) {
  const origin = appOrigin(request);
  return Response.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      scopes_supported: ["books:read", "books:write"],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
      service_documentation: `${origin}/`,
    },
    { headers: { "cache-control": "public, max-age=300" } },
  );
}
