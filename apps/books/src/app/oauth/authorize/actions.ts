"use server";

import { redirect } from "next/navigation";
import { currentSession } from "@/lib/session";
import { membershipsFor } from "@/lib/auth";
import { getClient, redirectUriAllowed, parseScopes, issueCode } from "@/lib/oauth";

export type ApproveInput = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  state: string;
};

/**
 * Grants an authorization code.
 *
 * Every parameter is re-validated here rather than trusted from the form: the
 * consent screen is a hint about what was asked for, not authority for what is
 * granted. A tampered form field must not widen the grant.
 */
export async function approveAuthorization(input: ApproveInput) {
  const session = await currentSession();
  if (!session) redirect("/login");

  const client = await getClient(input.clientId);
  if (!client) throw new Error("unknown client");
  if (!redirectUriAllowed(client.redirectUris, input.redirectUri)) {
    throw new Error("redirect_uri is not registered for this client");
  }

  const memberships = await membershipsFor(session.userId);
  const active = memberships.find((m) => m.tenantId === session.tenantId);
  if (!active) throw new Error("no active membership");

  const scopes = parseScopes(input.scope, active.role);
  if (scopes.length === 0) throw new Error("no grantable scopes");

  const code = await issueCode({
    clientId: input.clientId,
    userId: session.userId,
    tenantId: session.tenantId,
    role: active.role,
    scopes,
    codeChallenge: input.codeChallenge,
    redirectUri: input.redirectUri,
  });

  const url = new URL(input.redirectUri);
  url.searchParams.set("code", code);
  if (input.state) url.searchParams.set("state", input.state);
  redirect(url.toString());
}

export async function denyAuthorization(input: ApproveInput) {
  const url = new URL(input.redirectUri);
  url.searchParams.set("error", "access_denied");
  if (input.state) url.searchParams.set("state", input.state);
  redirect(url.toString());
}
