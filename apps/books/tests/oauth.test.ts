/**
 * The OAuth 2.1 authorization server.
 *
 * These are the properties that decide whether granting an MCP client access is
 * safe: a code cannot be replayed, a code cannot be redeemed without the
 * matching verifier, a token cannot outrank the role that approved it, and a
 * refresh token cannot be used twice.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { randomBytes } from "node:crypto";
import { makeTenant, closePool } from "./harness";
import {
  registerClient,
  getClient,
  redirectUriAllowed,
  parseScopes,
  issueCode,
  claimCode,
  issueTokens,
  refreshTokens,
  s256,
  verifyClientSecret,
} from "../src/lib/oauth";
import { resolveOauthToken } from "../src/lib/mcp-auth";
import { createUser, addMembership } from "../src/lib/auth";
import { can } from "@cashish/core/rbac";

let tenant: string;
let userId: string;

before(async () => {
  tenant = (await makeTenant("oauth")).id;
  userId = await createUser({
    email: `oauth-${Date.now()}@example.com`,
    password: "a-long-enough-passphrase",
  });
  await addMembership(userId, tenant, "owner");
});
after(closePool);

const verifier = () => randomBytes(32).toString("base64url");

test("registration returns a secret only for a confidential client", async () => {
  const pub = await registerClient({
    redirectUris: ["https://example.test/cb"],
    name: "Public client",
    confidential: false,
  });
  assert.equal(pub.clientSecret, undefined, "a public client relies on PKCE, not a secret");
  // No stored secret means secret verification must pass without one.
  const pubRow = await getClient(pub.clientId);
  assert.equal(verifyClientSecret(pubRow!.clientSecretHash, null), true);

  const conf = await registerClient({
    redirectUris: ["https://example.test/cb"],
    name: "Confidential client",
    confidential: true,
  });
  assert.ok(conf.clientSecret);
  const confRow = await getClient(conf.clientId);
  assert.equal(verifyClientSecret(confRow!.clientSecretHash, conf.clientSecret!), true);
  assert.equal(verifyClientSecret(confRow!.clientSecretHash, "wrong"), false);
  assert.equal(verifyClientSecret(confRow!.clientSecretHash, null), false);
});

test("redirect_uri matching is exact, not prefix", () => {
  const registered = ["https://claude.ai/api/mcp/auth_callback"];
  assert.equal(redirectUriAllowed(registered, "https://claude.ai/api/mcp/auth_callback"), true);
  // The classic hole: a prefix match would accept all of these.
  assert.equal(redirectUriAllowed(registered, "https://claude.ai/api/mcp/auth_callback/evil"), false);
  assert.equal(redirectUriAllowed(registered, "https://claude.ai.evil.test/api/mcp/auth_callback"), false);
  assert.equal(redirectUriAllowed(registered, "https://claude.ai/api/mcp/auth_callback?x=1"), false);
});

test("scopes are the intersection with the role, never the request", () => {
  assert.deepEqual(parseScopes("books:read books:write", "owner"), ["books:read", "books:write"]);
  assert.deepEqual(
    parseScopes("books:read books:write", "viewer"),
    ["books:read"],
    "a viewer asking for write gets read only",
  );
  assert.deepEqual(parseScopes("books:write", "viewer"), [], "and nothing at all if that is all it asked for");
  assert.deepEqual(parseScopes("nonsense", "owner"), [], "unknown scopes are dropped, not honoured");
  assert.deepEqual(parseScopes(null, "owner"), ["books:read"], "no scope requested defaults to read");
});

test("an authorization code works once and cannot be replayed", async () => {
  const client = await registerClient({
    redirectUris: ["https://example.test/cb"],
    name: "Replay test",
    confidential: false,
  });
  const v = verifier();
  const code = await issueCode({
    clientId: client.clientId,
    userId,
    tenantId: tenant,
    role: "owner",
    scopes: ["books:read"],
    codeChallenge: s256(v),
    redirectUri: "https://example.test/cb",
  });

  const first = await claimCode(code);
  assert.ok(first, "the first redemption succeeds");
  assert.equal(first!.tenantId, tenant);
  assert.equal(s256(v), first!.codeChallenge, "and the verifier matches the stored challenge");

  const second = await claimCode(code);
  assert.equal(second, null, "a replayed code must lose");
});

test("simultaneous redemptions of one code: exactly one wins", async () => {
  const client = await registerClient({
    redirectUris: ["https://example.test/cb"],
    name: "Race test",
    confidential: false,
  });
  const v = verifier();
  const code = await issueCode({
    clientId: client.clientId,
    userId,
    tenantId: tenant,
    role: "owner",
    scopes: ["books:read"],
    codeChallenge: s256(v),
    redirectUri: "https://example.test/cb",
  });

  // The atomic UPDATE ... WHERE consumed_at IS NULL is what makes this safe;
  // a read-then-mark implementation would let several through.
  const results = await Promise.all(Array.from({ length: 8 }, () => claimCode(code)));
  assert.equal(results.filter(Boolean).length, 1, "exactly one redemption may succeed");
});

test("a wrong code_verifier does not match the challenge", async () => {
  const v = verifier();
  const other = verifier();
  assert.notEqual(s256(other), s256(v));
  // S256 is deterministic, which is what lets the token endpoint compare them.
  assert.equal(s256(v), s256(v));
});

test("an access token resolves to its tenant, capped by its scopes", async () => {
  const client = await registerClient({
    redirectUris: ["https://example.test/cb"],
    name: "Token test",
    confidential: false,
  });
  const readOnly = await issueTokens({
    clientId: client.clientId,
    userId,
    tenantId: tenant,
    role: "owner",
    scopes: "books:read",
  });

  const resolved = await resolveOauthToken(readOnly.access_token);
  assert.equal(resolved?.tenantId, tenant);
  assert.equal(
    resolved?.role,
    "viewer",
    "an owner-granted token scoped books:read must not be able to write",
  );
  assert.equal(can(resolved!.role, "books:write"), false);

  const readWrite = await issueTokens({
    clientId: client.clientId,
    userId,
    tenantId: tenant,
    role: "owner",
    scopes: "books:read books:write",
  });
  const rw = await resolveOauthToken(readWrite.access_token);
  assert.equal(rw?.role, "owner");
  assert.equal(can(rw!.role, "books:write"), true);

  assert.equal(await resolveOauthToken("not-a-token"), null);
  assert.equal(
    await resolveOauthToken(readOnly.refresh_token),
    null,
    "a refresh token is not an access token",
  );
});

test("refresh rotates, and the old refresh token stops working", async () => {
  const client = await registerClient({
    redirectUris: ["https://example.test/cb"],
    name: "Refresh test",
    confidential: false,
  });
  const issued = await issueTokens({
    clientId: client.clientId,
    userId,
    tenantId: tenant,
    role: "owner",
    scopes: "books:read",
  });

  const rotated = await refreshTokens(issued.refresh_token, client.clientId);
  assert.ok(rotated, "a valid refresh token yields a new pair");
  assert.notEqual(rotated!.refresh_token, issued.refresh_token);

  assert.equal(
    await refreshTokens(issued.refresh_token, client.clientId),
    null,
    "the presented refresh token is single-use",
  );
  assert.equal(
    await refreshTokens(rotated!.refresh_token, "cc_someone_else"),
    null,
    "and a refresh token is bound to its client",
  );
});
