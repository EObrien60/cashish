"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db, first, schema } from "@/db/client";
import { runInTenant } from "@/db/context";
import {
  authenticate,
  membershipsFor,
  roleFor,
  addMembership,
  createUser,
  findUserByEmail,
  createApiKey,
  revokeApiKey,
  sha256,
} from "@/lib/auth";
import { currentSession, setSessionCookie, clearSessionCookie } from "@/lib/session";
import { isRole, requireCapability, type Role } from "@/lib/rbac";
import { uid } from "@/lib/id";

const { invites, memberships, users } = schema;

// ---------------------------------------------------------------------------
// Actions that run *outside* a tenant context, because they are what decides
// which tenant you are in. Everything here filters explicitly.
// ---------------------------------------------------------------------------

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");

  const user = await authenticate(email, password);
  // One message for both a wrong password and an unknown address: telling them
  // apart is a free list of who has an account here.
  if (!user) return { error: "Those details do not match an account." };

  const tenants = await membershipsFor(user.id);
  if (tenants.length === 0) {
    return { error: "That account is not a member of any business yet." };
  }
  await setSessionCookie({ uid: user.id, tid: tenants[0].tenantId });
  redirect(next.startsWith("/") ? next : "/");
}

export async function logout() {
  await clearSessionCookie();
  redirect("/login");
}

/** Switch the active tenant, re-verifying membership rather than trusting input. */
export async function switchTenant(tenantId: string) {
  const session = await currentSession();
  if (!session) redirect("/login");
  const role = await roleFor(session.userId, tenantId);
  if (!role) throw new Error("not a member of that business");
  await setSessionCookie({ uid: session.userId, tid: tenantId });
  revalidatePath("/", "layout");
}

// ---- Members and invites (owner only) --------------------------------------

export async function inviteMember(formData: FormData) {
  const session = await currentSession();
  if (!session) throw new Error("not authenticated");
  requireCapability(session.role, "tenant:admin");

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const roleValue = String(formData.get("role") ?? "viewer");
  if (!email) return { error: "An email address is required." };
  if (!isRole(roleValue)) return { error: "Unknown role." };

  // The token is returned once, in the link. Only its hash is stored.
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await db.insert(invites).values({
    id: uid(),
    tenantId: session.tenantId,
    email,
    role: roleValue,
    tokenHash: sha256(token),
    expiresAt: expires,
    createdBy: session.userId,
  });
  revalidatePath("/settings/team");
  // No email provider in this project by design — the owner copies the link.
  return { link: `${process.env.APP_URL ?? ""}/accept-invite/${token}`, expires };
}

export async function acceptInvite(token: string, formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "");
  if (password.length < 12) {
    return { error: "Choose a password of at least 12 characters." };
  }

  const invite = first(
    await db.select().from(invites).where(eq(invites.tokenHash, sha256(token))).limit(1),
  );
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date().toISOString()) {
    return { error: "That invitation is no longer valid." };
  }
  if (!isRole(invite.role)) return { error: "That invitation is malformed." };

  const existing = await findUserByEmail(invite.email);
  const userId = existing?.id ?? (await createUser({ email: invite.email, password, name }));
  await addMembership(userId, invite.tenantId, invite.role);
  await db
    .update(invites)
    .set({ acceptedAt: new Date().toISOString() })
    .where(eq(invites.id, invite.id));

  await setSessionCookie({ uid: userId, tid: invite.tenantId });
  redirect("/");
}

export async function removeMember(userId: string) {
  const session = await currentSession();
  if (!session) throw new Error("not authenticated");
  requireCapability(session.role, "tenant:admin");
  if (userId === session.userId) {
    return { error: "You cannot remove your own access." };
  }
  await db
    .delete(memberships)
    .where(and(eq(memberships.tenantId, session.tenantId), eq(memberships.userId, userId)));
  revalidatePath("/settings/team");
}

export async function changeMemberRole(userId: string, role: Role) {
  const session = await currentSession();
  if (!session) throw new Error("not authenticated");
  requireCapability(session.role, "tenant:admin");

  if (userId === session.userId && role !== "owner") {
    // Otherwise a sole owner can lock the business out of its own settings.
    const owners = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.tenantId, session.tenantId), eq(memberships.role, "owner")));
    if (owners.length <= 1) return { error: "A business needs at least one owner." };
  }
  await addMembership(userId, session.tenantId, role);
  revalidatePath("/settings/team");
}

export async function listMembers() {
  const session = await currentSession();
  if (!session) throw new Error("not authenticated");
  return db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.tenantId, session.tenantId));
}

// ---- API keys (owner only) -------------------------------------------------

export async function createKey(formData: FormData) {
  const session = await currentSession();
  if (!session) throw new Error("not authenticated");
  requireCapability(session.role, "tenant:admin");

  const name = String(formData.get("name") ?? "").trim() || "Untitled key";
  const roleValue = String(formData.get("role") ?? "viewer");
  if (!isRole(roleValue)) return { error: "Unknown role." };

  const { key } = await runInTenant(
    { tenantId: session.tenantId, role: session.role, actor: `user:${session.userId}` },
    () =>
      createApiKey({
        tenantId: session.tenantId,
        name,
        role: roleValue,
        createdBy: session.userId,
      }),
  );
  revalidatePath("/settings/keys");
  // Shown once. There is no way to retrieve it again, by design.
  return { key };
}

export async function revokeKey(id: string) {
  const session = await currentSession();
  if (!session) throw new Error("not authenticated");
  requireCapability(session.role, "tenant:admin");
  await revokeApiKey(session.tenantId, id);
  revalidatePath("/settings/keys");
}
