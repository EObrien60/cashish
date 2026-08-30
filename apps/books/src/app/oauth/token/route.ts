import {
  claimCode,
  getClient,
  issueTokens,
  refreshTokens,
  s256,
  verifyClientSecret,
} from "@/lib/oauth";
import { roleFor } from "@/lib/auth";
import type { Role } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const bad = (error: string, description?: string, status = 400) =>
  Response.json(
    { error, ...(description ? { error_description: description } : {}) },
    { status, headers: { "cache-control": "no-store" } },
  );

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) return bad("invalid_request", "expected application/x-www-form-urlencoded");
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" && value ? value : null;
  };

  const grantType = field("grant_type");
  const clientId = field("client_id");
  if (!clientId) return bad("invalid_client", "client_id is required");

  const client = await getClient(clientId);
  if (!client) return bad("invalid_client", "unknown client", 401);
  if (!verifyClientSecret(client.clientSecretHash, field("client_secret"))) {
    return bad("invalid_client", "client authentication failed", 401);
  }

  if (grantType === "refresh_token") {
    const presented = field("refresh_token");
    if (!presented) return bad("invalid_request", "refresh_token is required");
    const tokens = await refreshTokens(presented, clientId);
    // A refresh token is single-use: presenting a rotated one is either a replay
    // or a client that lost the response, and both deserve a refusal.
    if (!tokens) return bad("invalid_grant", "refresh token is expired, revoked or already used");
    return Response.json(tokens, { headers: { "cache-control": "no-store" } });
  }

  if (grantType !== "authorization_code") {
    return bad("unsupported_grant_type", `grant_type "${grantType ?? ""}" is not supported`);
  }

  const code = field("code");
  const verifier = field("code_verifier");
  const redirectUri = field("redirect_uri");
  if (!code) return bad("invalid_request", "code is required");
  if (!verifier) return bad("invalid_request", "code_verifier is required (PKCE is mandatory)");

  const claimed = await claimCode(code);
  if (!claimed) return bad("invalid_grant", "code is unknown, expired, or already used");
  if (claimed.clientId !== clientId) return bad("invalid_grant", "code was issued to another client");
  if (redirectUri && redirectUri !== claimed.redirectUri) {
    return bad("invalid_grant", "redirect_uri does not match the authorization request");
  }
  if (s256(verifier) !== claimed.codeChallenge) {
    return bad("invalid_grant", "code_verifier does not match the challenge");
  }

  // Re-read the role at exchange time rather than trusting what was stored with
  // the code: an owner demoted between approving and exchanging must not receive
  // an owner token.
  const role: Role | null = await roleFor(claimed.userId, claimed.tenantId);
  if (!role) return bad("invalid_grant", "the approving user is no longer a member of that business");

  const tokens = await issueTokens({
    clientId,
    userId: claimed.userId,
    tenantId: claimed.tenantId,
    role,
    scopes: claimed.scopes,
  });
  return Response.json(tokens, { headers: { "cache-control": "no-store" } });
}
