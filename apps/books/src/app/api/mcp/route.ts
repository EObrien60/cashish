import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { runInTenant } from "@/db/context";
import { registerTools } from "../../../../mcp/tools";
import { resolveCredential, unauthorised } from "@/lib/mcp-auth";

export const dynamic = "force-dynamic";
// Node, not Edge: AsyncLocalStorage and pg both need it.
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// cashish over Streamable HTTP — the public MCP endpoint.
//
// Stateless (sessionIdGenerator: undefined): a serverless instance cannot be
// relied on to hold a session between requests, so pretending to would produce
// intermittent "unknown session" failures under exactly the traffic that spins
// up a second instance.
//
// A fresh server per request is cheap — registerTools only builds descriptors —
// and it means the tool set reflects THIS caller's role rather than whoever
// happened to connect first.
// ---------------------------------------------------------------------------

async function handle(request: Request): Promise<Response> {
  const credential = await resolveCredential(request);
  if (!credential) return unauthorised(request);

  return runInTenant(credential, async () => {
    const server = new McpServer({ name: "cashish", version: "2.0.0" });
    registerTools(server, { role: credential.role });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  });
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
