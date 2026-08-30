import { redirect } from "next/navigation";
import { runInTenant } from "@cashish/core/db";
import { currentSession, type Session } from "./session";
import { requireCapability, type Capability } from "@cashish/core/rbac";

// ---------------------------------------------------------------------------
// The bridge between "who is asking" and the tenant-scoped query layer.
//
// Every page and every server action goes through one of these. Nothing in
// src/lib/* can run without it, because @cashish/core/db throws when there is
// no tenant in scope — which is the point: forgetting the wrapper produces a
// loud error, not a query across every tenant's books.
// ---------------------------------------------------------------------------

/** For pages. Redirects to the login screen when there is no valid session. */
export async function withTenant<T>(fn: (session: Session) => Promise<T>): Promise<T> {
  const session = await currentSession();
  if (!session) redirect("/login");
  return runInTenant(
    { tenantId: session.tenantId, role: session.role, actor: `user:${session.userId}` },
    () => fn(session),
  );
}

/**
 * For server actions. Requires a capability up front and throws rather than
 * redirecting, so a forbidden mutation surfaces as an error instead of a
 * confusing navigation.
 */
export async function withCapability<T>(
  capability: Capability,
  fn: (session: Session) => Promise<T>,
): Promise<T> {
  const session = await currentSession();
  if (!session) throw new Error("not authenticated");
  requireCapability(session.role, capability);
  return runInTenant(
    { tenantId: session.tenantId, role: session.role, actor: `user:${session.userId}` },
    () => fn(session),
  );
}
