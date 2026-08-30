#!/usr/bin/env tsx
/**
 * cashish over stdio, for a local agent.
 *
 *   DATABASE_URL=… CASHISH_TENANT=<slug> npm run mcp
 *   CASHISH_MCP_ROLE=viewer npm run mcp        # read-only
 *
 * The tenant must be named: this process talks to a multi-tenant database and
 * "whose books?" has no default answer. The role defaults to owner because a
 * local operator already has the connection string, so pretending otherwise
 * would be theatre — but it can be lowered to rehearse what a restricted
 * credential sees.
 *
 * The tool definitions live in mcp/tools.ts, shared with the HTTP transport.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runInTenant } from "../src/db/context";
import { findTenantBySlug } from "../src/db/seed";
import { isRole, type Role } from "../src/lib/rbac";
import { registerTools } from "./tools";

async function main() {
  const slug = process.env.CASHISH_TENANT;
  if (!slug) {
    throw new Error(
      "CASHISH_TENANT is not set. Name the tenant whose books this server should serve.",
    );
  }
  const tenant = await findTenantBySlug(slug);
  if (!tenant) throw new Error(`no tenant with slug "${slug}"`);

  const roleEnv = process.env.CASHISH_MCP_ROLE ?? "owner";
  if (!isRole(roleEnv)) throw new Error(`CASHISH_MCP_ROLE must be owner, accountant or viewer`);
  const role: Role = roleEnv;

  const server = new McpServer({ name: "cashish", version: "2.0.0" });
  registerTools(server, { role });

  // Every tool call runs inside the tenant context, established once here.
  await runInTenant({ tenantId: tenant.id, role, actor: `stdio:${slug}` }, async () => {
    await server.connect(new StdioServerTransport());
    // Resolve only when the transport closes, so the context outlives the session.
    await new Promise<void>((resolve) => {
      server.server.onclose = () => resolve();
    });
  });
}

main().catch((error) => {
  // stdout is the protocol channel — diagnostics must go to stderr.
  console.error("cashish mcp failed to start:", error);
  process.exit(1);
});
