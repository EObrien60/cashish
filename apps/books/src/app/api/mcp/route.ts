import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { runInTenant } from "@cashish/core/db";
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

// The endpoint is POST-only. MCP's Streamable HTTP transport lets a server
// decline the optional standalone SSE stream by answering GET with 405, and this
// one must: the SDK's handleGetRequest opens an unbounded keepalive stream
// instead of declining, and on a serverless host that open response keeps the
// invocation — and its provisioned memory — billable for as long as the client
// holds the socket. Nothing is ever pushed into it either, because the transport
// is stateless: the McpServer above is built per request and is gone by the time
// a notification could exist. Same reasoning for DELETE, which has no session to
// terminate here.
//
// This runs before resolveCredential deliberately. Clients that lose the stream
// reconnect in a loop, and a rejected request must not cost a database round
// trip to answer.
const methodNotAllowed = (_request: Request): Response =>
  new Response(null, { status: 405, headers: { Allow: "POST" } });

export const POST = handle;
export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
