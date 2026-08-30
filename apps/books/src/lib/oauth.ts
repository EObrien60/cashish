import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, first, schema } from "@cashish/core/db";
import { sha256 } from "./auth";
import { uid } from "./id";
import { SCOPES, scopesForRole, type Role, type Scope } from "@cashish/core/rbac";

const { oauthClients, oauthCodes, oauthTokens } = schema;

// ---------------------------------------------------------------------------
// cashish as an OAuth 2.1 authorization server.
//
// This exists so an MCP client that cannot be handed a long-lived API key —
// claude.ai's Connectors, principally — can be granted scoped access to one
// tenant's books through a consent screen instead.
//
// Deliberate positions:
//
//   - PKCE with S256 is MANDATORY, for confidential and public clients alike.
//     OAuth 2.1 removes the implicit grant and requires PKCE; there is no reason
//     to support the weaker shapes for a greenfield server.
//   - Authorization codes are single-use and consumed by the same UPDATE that
//     reads them, so a replayed code loses the race rather than being honoured.
//   - Codes and tokens are stored only as SHA-256 hashes. A leaked database
//     backup does not hand over live credentials.
//   - A token's scopes are intersected with the granting user's role. An
//     accountant cannot mint a token that outranks an accountant, and a viewer
//     cannot obtain books:write no matter what it asks for.
//   - redirect_uri must match a registered value exactly. No prefix or
//     wildcard matching, which is how redirect_uri validation usually breaks.
// ---------------------------------------------------------------------------

const ACCESS_TTL_SECONDS = 60 * 60; // 1 hour
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const CODE_TTL_SECONDS = 60 * 5; // 5 minutes

const iso = (secondsFromNow: number) =>
  new Date(Date.now() + secondsFromNow * 1000).toISOString();

export const s256 = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

export type RegisteredClient = {
  clientId: string;
  clientSecret?: string;
  redirectUris: string[];
  name: string;
};

/** Dynamic client registration (RFC 7591). */
export async function registerClient(input: {
  redirectUris: string[];
  name: string;
  /** Public clients (native apps, browser) get no secret and rely on PKCE. */
  confidential: boolean;
}): Promise<RegisteredClient> {
  const clientId = `cc_${randomBytes(16).toString("base64url")}`;
  const clientSecret = input.confidential
    ? `cs_${randomBytes(32).toString("base64url")}`
    : undefined;
  await db.insert(oauthClients).values({
    id: uid(),
    clientId,
    clientSecretHash: clientSecret ? sha256(clientSecret) : null,
    name: input.name,
    redirectUris: JSON.stringify(input.redirectUris),
  });
  return { clientId, clientSecret, redirectUris: input.redirectUris, name: input.name };
}

export async function getClient(clientId: string) {
  const row = first(
    await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1),
  );
  if (!row) return null;
  let redirectUris: string[] = [];
  try {
    const parsed = JSON.parse(row.redirectUris);
    if (Array.isArray(parsed)) redirectUris = parsed.filter((u) => typeof u === "string");
  } catch {
    redirectUris = [];
  }
  return { ...row, redirectUris };
}

/** Exact match only — never a prefix or wildcard. */
export function redirectUriAllowed(registered: string[], candidate: string): boolean {
  return registered.includes(candidate);
}

export function parseScopes(requested: string | null, role: Role): Scope[] {
  const allowed = scopesForRole(role);
  if (!requested) return allowed.includes("books:read") ? ["books:read"] : [];
  const asked = requested.split(/[\s+]+/).filter(Boolean);
  // Intersection, not the request: a token can never exceed its granting role.
  return SCOPES.filter((s) => asked.includes(s) && allowed.includes(s));
}

export async function issueCode(input: {
  clientId: string;
  userId: string;
  tenantId: string;
  role: Role;
  scopes: Scope[];
  codeChallenge: string;
  redirectUri: string;
}): Promise<string> {
  const code = randomBytes(32).toString("base64url");
  await db.insert(oauthCodes).values({
    codeHash: sha256(code),
    clientId: input.clientId,
    userId: input.userId,
    tenantId: input.tenantId,
    role: input.role,
    scopes: input.scopes.join(" "),
    codeChallenge: input.codeChallenge,
    redirectUri: input.redirectUri,
    expiresAt: iso(CODE_TTL_SECONDS),
  });
  return code;
}

/**
 * Claims an authorization code, atomically.
 *
 * The UPDATE ... WHERE consumed_at IS NULL RETURNING is the whole point: two
 * simultaneous redemptions of the same code cannot both succeed, because only
 * one UPDATE can find the row unconsumed. Reading first and then marking it
 * would leave exactly that race open.
 */
export async function claimCode(code: string) {
  const now = new Date().toISOString();
  const [row] = await db
    .update(oauthCodes)
    .set({ consumedAt: now })
    .where(and(eq(oauthCodes.codeHash, sha256(code)), isNull(oauthCodes.consumedAt)))
    .returning();
  if (!row) return null;
  if (row.expiresAt < now) return null;
  return row;
}

export type IssuedTokens = {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
};

export async function issueTokens(input: {
  clientId: string;
  userId: string;
  tenantId: string;
  role: Role;
  scopes: string;
}): Promise<IssuedTokens> {
  const access = randomBytes(32).toString("base64url");
  const refresh = randomBytes(32).toString("base64url");
  const common = {
    clientId: input.clientId,
    userId: input.userId,
    tenantId: input.tenantId,
    role: input.role,
    scopes: input.scopes,
  };
  await db.insert(oauthTokens).values([
    { ...common, tokenHash: sha256(access), kind: "access", expiresAt: iso(ACCESS_TTL_SECONDS) },
    { ...common, tokenHash: sha256(refresh), kind: "refresh", expiresAt: iso(REFRESH_TTL_SECONDS) },
  ]);
  return {
    access_token: access,
    refresh_token: refresh,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_SECONDS,
    scope: input.scopes,
  };
}

/** Rotates a refresh token: the presented one is revoked as the new pair is issued. */
export async function refreshTokens(refreshToken: string, clientId: string) {
  const now = new Date().toISOString();
  const [row] = await db
    .update(oauthTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(oauthTokens.tokenHash, sha256(refreshToken)),
        eq(oauthTokens.kind, "refresh"),
        eq(oauthTokens.clientId, clientId),
        isNull(oauthTokens.revokedAt),
      ),
    )
    .returning();
  if (!row || row.expiresAt < now) return null;
  return issueTokens({
    clientId: row.clientId,
    userId: row.userId,
    tenantId: row.tenantId,
    role: row.role as Role,
    scopes: row.scopes,
  });
}

export function verifyClientSecret(storedHash: string | null, presented: string | null): boolean {
  // A public client has no secret; PKCE is what authenticates it.
  if (!storedHash) return true;
  if (!presented) return false;
  const a = Buffer.from(storedHash, "utf8");
  const b = Buffer.from(sha256(presented), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
