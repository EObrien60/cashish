import { appOrigin } from "@/lib/origin";

export const dynamic = "force-dynamic";

// RFC 9728. This is what an MCP client fetches after a 401 from /api/mcp to
// learn which authorization server guards this resource.
export async function GET(request: Request) {
  const origin = appOrigin(request);
  return Response.json(
    {
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
      scopes_supported: ["books:read", "books:write"],
      bearer_methods_supported: ["header"],
      resource_documentation: `${origin}/`,
    },
    { headers: { "cache-control": "public, max-age=300" } },
  );
}
