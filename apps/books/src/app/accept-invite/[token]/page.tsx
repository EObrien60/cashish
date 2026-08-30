import { eq } from "drizzle-orm";
import { db, first, schema } from "@/db/client";
import { sha256 } from "@/lib/auth";
import { acceptInvite } from "../../auth-actions";
import { AcceptInviteForm } from "@/components/AcceptInviteForm";
import { Card } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = first(
    await db
      .select({
        email: schema.invites.email,
        role: schema.invites.role,
        expiresAt: schema.invites.expiresAt,
        acceptedAt: schema.invites.acceptedAt,
        business: schema.tenants.name,
      })
      .from(schema.invites)
      .innerJoin(schema.tenants, eq(schema.invites.tenantId, schema.tenants.id))
      .where(eq(schema.invites.tokenHash, sha256(token)))
      .limit(1),
  );

  const valid =
    invite && !invite.acceptedAt && invite.expiresAt >= new Date().toISOString();

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm">
        {!valid ? (
          <Card className="p-6 text-center">
            <p className="text-sm text-ink-soft">
              That invitation is no longer valid. Ask whoever invited you for a new link.
            </p>
          </Card>
        ) : (
          <>
            <div className="mb-8 text-center">
              <h1 className="text-2xl font-semibold tracking-tight">{invite.business}</h1>
              <p className="mt-1 text-sm text-ink-soft">
                Joining as <strong>{invite.role}</strong>, with {invite.email}.
              </p>
            </div>
            <AcceptInviteForm token={token} action={acceptInvite} />
          </>
        )}
      </div>
    </div>
  );
}
