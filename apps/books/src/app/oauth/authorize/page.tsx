import { redirect } from "next/navigation";
import { currentSession } from "@/lib/session";
import { membershipsFor } from "@/lib/auth";
import { getClient, redirectUriAllowed, parseScopes } from "@/lib/oauth";
import { approveAuthorization } from "./actions";
import { ConsentForm } from "@/components/ConsentForm";
import { Card } from "@/components/ui";

export const dynamic = "force-dynamic";

type Params = {
  client_id?: string;
  redirect_uri?: string;
  response_type?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  scope?: string;
  state?: string;
};

function Problem({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="max-w-md p-6">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-ink-soft">{detail}</p>
      </Card>
    </div>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const sp = await searchParams;

  // Errors that mean the REQUEST is malformed are shown here rather than
  // redirected back: bouncing to an unvalidated redirect_uri would make this an
  // open redirector.
  if (!sp.client_id) return <Problem title="Invalid request" detail="client_id is missing." />;
  const client = await getClient(sp.client_id);
  if (!client) return <Problem title="Unknown application" detail="That client_id is not registered." />;
  if (!sp.redirect_uri || !redirectUriAllowed(client.redirectUris, sp.redirect_uri)) {
    return (
      <Problem
        title="Invalid redirect"
        detail="The redirect_uri does not exactly match one registered by this application."
      />
    );
  }

  // From here the redirect_uri is trusted, so protocol errors go back to it.
  const back = (error: string, description: string) => {
    const url = new URL(sp.redirect_uri!);
    url.searchParams.set("error", error);
    url.searchParams.set("error_description", description);
    if (sp.state) url.searchParams.set("state", sp.state);
    redirect(url.toString());
  };
  if (sp.response_type !== "code") back("unsupported_response_type", "only response_type=code is supported");
  if (!sp.code_challenge) back("invalid_request", "code_challenge is required (PKCE is mandatory)");
  if (sp.code_challenge_method !== "S256") {
    back("invalid_request", "code_challenge_method must be S256");
  }

  // Middleware keeps this route behind the session gate, so an anonymous visitor
  // has already been sent to /login?next=<this url> and comes back here intact.
  const session = await currentSession();
  if (!session) redirect("/login");

  const memberships = await membershipsFor(session.userId);
  const active = memberships.find((m) => m.tenantId === session.tenantId);
  if (!active) return <Problem title="No business selected" detail="Sign in again and pick a business." />;

  const scopes = parseScopes(sp.scope ?? null, active.role);
  if (scopes.length === 0) {
    back("invalid_scope", `your role (${active.role}) grants none of the requested scopes`);
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <ConsentForm
          clientName={client.name}
          businessName={active.name}
          role={active.role}
          scopes={scopes}
          action={approveAuthorization}
          params={{
            clientId: sp.client_id,
            redirectUri: sp.redirect_uri,
            codeChallenge: sp.code_challenge!,
            scope: scopes.join(" "),
            state: sp.state ?? "",
          }}
        />
      </div>
    </div>
  );
}
