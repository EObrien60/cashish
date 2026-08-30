import { and, eq, isNull, gt } from "drizzle-orm";
import { db, first, schema } from "@/db/client";
import { resolveApiKey, sha256, type ResolvedCredential } from "./auth";
import { isRole } from "./rbac";

const { oauthTokens } = schema;

// ---------------------------------------------------------------------------
// Who is calling /api/mcp.
//
// Two credential types resolve to the same { tenantId, role, actor } so the
// tool layer never learns which was used:
//
//   Authorization: Bearer ck_live_…   an API key      (scripts, Claude Code)
//   Authorization: Bearer <token>     an OAuth token  (claude.ai Connector)
//
// A 401 carries WWW-Authenticate with resource_metadata, which is how an MCP
// client discovers it should start the OAuth flow rather than simply giving up.
// ---------------------------------------------------------------------------

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) return null;
  const value = header.slice(7).trim();
  return value || null;
}

export async function resolveOauthToken(token: string): Promise<ResolvedCredential | null> {
  const row = first(
    await db
      .select()
      .from(oauthTokens)
      .where(
        and(
          eq(oauthTokens.tokenHash, sha256(token)),
          eq(oauthTokens.kind, "access"),
          isNull(oauthTokens.revokedAt),
          gt(oauthTokens.expiresAt, new Date().toISOString()),
        ),
      )
      .limit(1),
  );
  if (!row || !isRole(row.role)) return null;

  // The token's own scopes cap what it can do, independently of the role it was
  // granted under — a books:read token stays read-only even for an owner.
  const scopes = row.scopes.split(" ").filter(Boolean);
  const role = scopes.includes("books:write") ? row.role : "viewer";
  return { tenantId: row.tenantId, role, actor: `oauth:${row.clientId}` };
}

export async function resolveCredential(request: Request): Promise<ResolvedCredential | null> {
  const token = bearer(request);
  if (!token) return null;
  return token.startsWith("ck_live_") ? resolveApiKey(token) : resolveOauthToken(token);
}

export function unauthorised(request: Request): Response {
  const origin = process.env.APP_URL ?? new URL(request.url).origin;
  return Response.json(
    {
      error: "unauthorised",
      hint:
        "Send a cashish API key (Authorization: Bearer ck_live_…) or complete the OAuth flow " +
        "advertised at /.well-known/oauth-protected-resource.",
    },
    {
      status: 401,
      headers: {
        "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
      },
    },
  );
}
