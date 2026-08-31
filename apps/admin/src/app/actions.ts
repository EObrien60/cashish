"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@cashish/core/db";
import { isRole } from "@cashish/core/rbac";
import { isPlanCode, isSubscriptionStatus, FEATURE_KEYS, type PlanFeatures } from "@cashish/core/plans";
import { requireAdmin } from "@/lib/admin-session";
import { withAudit } from "@/lib/audit";
import { getTenant, tenantFootprint } from "@/queries/tenants";
import { getUser } from "@/queries/users";

// ---------------------------------------------------------------------------
// Everything the console can change.
//
// Each action does the same four things in the same order: establish who is
// acting, read the prior state, mutate and record inside one transaction, then
// revalidate. The prior state is read BEFORE the transaction and passed in as
// `before` so the audit row says what changed rather than merely that something
// did — a log that records only the new value cannot answer "what was it?".
// ---------------------------------------------------------------------------

const {
  memberships,
  apiKeys,
  oauthTokens,
  tenants,
  users,
  subscriptions,
  plans,
} = schema;

const nowISO = () => new Date().toISOString();

type Result = { error?: string; ok?: true };

// ---- Members ---------------------------------------------------------------

export async function setMemberRole(formData: FormData): Promise<Result> {
  const admin = await requireAdmin();
  const tenantId = String(formData.get("tenantId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");

  if (!isRole(role)) return { error: `"${role}" is not a role.` };

  const detail = await getTenant(tenantId);
  const member = detail?.members.find((m) => m.userId === userId);
  if (!member) return { error: "That person is not a member of this business." };
  if (member.role === role) return { ok: true };

  await withAudit(
    admin.id,
    {
      action: "membership.role",
      subjectType: "user",
      subjectId: userId,
      tenantId,
      before: { role: member.role },
      after: { role },
    },
    async (trx) => {
      await trx
        .update(memberships)
        .set({ role })
        .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));
    },
  );

  revalidatePath(`/tenants/${tenantId}`);
  return { ok: true };
}

export async function removeMember(formData: FormData): Promise<Result> {
  const admin = await requireAdmin();
  const tenantId = String(formData.get("tenantId") ?? "");
  const userId = String(formData.get("userId") ?? "");

  const detail = await getTenant(tenantId);
  const member = detail?.members.find((m) => m.userId === userId);
  if (!member) return { error: "That person is not a member of this business." };

  // Removing the last owner leaves a business nobody can administer, and the
  // console has no way to appoint one from inside it.
  const owners = detail!.members.filter((m) => m.role === "owner");
  if (member.role === "owner" && owners.length === 1) {
    return { error: "That is the only owner. Promote somebody else first." };
  }

  await withAudit(
    admin.id,
    {
      action: "membership.remove",
      subjectType: "user",
      subjectId: userId,
      tenantId,
      before: { role: member.role, email: member.email },
    },
    async (trx) => {
      await trx
        .delete(memberships)
        .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));
    },
  );

  revalidatePath(`/tenants/${tenantId}`);
  return { ok: true };
}

// ---- Machine access --------------------------------------------------------

export async function revokeApiKey(formData: FormData): Promise<Result> {
  const admin = await requireAdmin();
  const keyId = String(formData.get("keyId") ?? "");
  const tenantId = String(formData.get("tenantId") ?? "");

  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, keyId)).limit(1);
  if (!key) return { error: "No such key." };
  if (key.revokedAt) return { ok: true };

  await withAudit(
    admin.id,
    {
      action: "api_key.revoke",
      subjectType: "tenant",
      subjectId: tenantId,
      tenantId,
      before: { keyId, name: key.name, prefix: key.prefix, role: key.role },
      after: { revoked: true },
    },
    async (trx) => {
      await trx.update(apiKeys).set({ revokedAt: nowISO() }).where(eq(apiKeys.id, keyId));
    },
  );

  revalidatePath(`/tenants/${tenantId}`);
  return { ok: true };
}

export async function revokeOauthTokens(formData: FormData): Promise<Result> {
  const admin = await requireAdmin();
  const tenantId = String(formData.get("tenantId") ?? "");
  const clientId = String(formData.get("clientId") ?? "");

  await withAudit(
    admin.id,
    {
      action: "oauth_token.revoke",
      subjectType: "tenant",
      subjectId: tenantId,
      tenantId,
      before: { clientId },
      after: { revoked: true },
    },
    async (trx) => {
      await trx
        .update(oauthTokens)
        .set({ revokedAt: nowISO() })
        .where(and(eq(oauthTokens.tenantId, tenantId), eq(oauthTokens.clientId, clientId)));
    },
  );

  revalidatePath(`/tenants/${tenantId}`);
  return { ok: true };
}

// ---- Tenants ---------------------------------------------------------------

export async function deleteTenant(formData: FormData): Promise<Result> {
  const admin = await requireAdmin();
  const tenantId = String(formData.get("tenantId") ?? "");
  const confirmation = String(formData.get("confirm") ?? "").trim();

  const footprint = await tenantFootprint(tenantId);
  if (!footprint) return { error: "No such business." };
  if (confirmation !== footprint.slug) {
    return { error: `Type ${footprint.slug} exactly to confirm.` };
  }

  // The footprint goes into `before` because after this commits, nothing else
  // in the database records that this business existed or how much was in it.
  await withAudit(
    admin.id,
    {
      action: "tenant.delete",
      subjectType: "tenant",
      subjectId: tenantId,
      tenantId,
      before: footprint,
    },
    async (trx) => {
      await trx.delete(tenants).where(eq(tenants.id, tenantId));
    },
  );

  revalidatePath("/tenants");
  return { ok: true };
}

// ---- Users -----------------------------------------------------------------

export async function setUserDisabled(formData: FormData): Promise<Result> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const disabled = String(formData.get("disabled") ?? "") === "true";

  const detail = await getUser(userId);
  if (!detail) return { error: "No such person." };

  await withAudit(
    admin.id,
    {
      action: disabled ? "user.disable" : "user.enable",
      subjectType: "user",
      subjectId: userId,
      before: { disabledAt: detail.user.disabledAt },
      after: { disabledAt: disabled ? nowISO() : null },
    },
    async (trx) => {
      await trx
        .update(users)
        .set({ disabledAt: disabled ? nowISO() : null })
        .where(eq(users.id, userId));
    },
  );

  revalidatePath(`/users/${userId}`);
  revalidatePath("/users");
  return { ok: true };
}

// ---- Subscriptions ---------------------------------------------------------

export async function saveSubscription(formData: FormData): Promise<Result> {
  const admin = await requireAdmin();
  const tenantId = String(formData.get("tenantId") ?? "");
  const planCode = String(formData.get("planCode") ?? "");
  const status = String(formData.get("status") ?? "");
  const trialEndsAt = String(formData.get("trialEndsAt") ?? "").trim() || null;
  const currentPeriodEnd = String(formData.get("currentPeriodEnd") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim();

  if (!isPlanCode(planCode)) return { error: `"${planCode}" is not a plan.` };
  if (!isSubscriptionStatus(status)) return { error: `"${status}" is not a status.` };

  const [existing] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .limit(1);

  const after = { planCode, status, trialEndsAt, currentPeriodEnd, note };

  await withAudit(
    admin.id,
    {
      action: existing ? "subscription.update" : "subscription.create",
      subjectType: "subscription",
      subjectId: existing?.id ?? tenantId,
      tenantId,
      before: existing
        ? {
            planCode: existing.planCode,
            status: existing.status,
            trialEndsAt: existing.trialEndsAt,
            currentPeriodEnd: existing.currentPeriodEnd,
            note: existing.note,
          }
        : undefined,
      after,
    },
    async (trx) => {
      if (existing) {
        await trx
          .update(subscriptions)
          .set({
            planCode,
            status,
            trialEndsAt,
            currentPeriodEnd,
            note,
            cancelledAt: status === "cancelled" ? (existing.cancelledAt ?? nowISO()) : null,
            updatedAt: nowISO(),
          })
          .where(eq(subscriptions.id, existing.id));
      } else {
        await trx.insert(subscriptions).values({
          id: randomUUID(),
          tenantId,
          planCode,
          status,
          trialEndsAt,
          currentPeriodEnd,
          note,
          cancelledAt: status === "cancelled" ? nowISO() : null,
        });
      }
    },
  );

  revalidatePath(`/tenants/${tenantId}`);
  revalidatePath("/subscriptions");
  return { ok: true };
}

/**
 * Suspend, and its inverse.
 *
 * Suspension is a subscription status rather than a column on the tenant: there
 * is exactly one place that answers "is this business entitled to run", and a
 * second flag would eventually disagree with it. Nothing is deleted, so it is
 * reversible.
 */
export async function setTenantSuspended(formData: FormData): Promise<Result> {
  const admin = await requireAdmin();
  const tenantId = String(formData.get("tenantId") ?? "");
  const suspended = String(formData.get("suspended") ?? "") === "true";

  const [existing] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .limit(1);
  if (!existing) return { error: "That business has no subscription to suspend." };

  const status = suspended ? "suspended" : "active";

  await withAudit(
    admin.id,
    {
      action: suspended ? "tenant.suspend" : "tenant.unsuspend",
      subjectType: "subscription",
      subjectId: existing.id,
      tenantId,
      before: { status: existing.status },
      after: { status },
    },
    async (trx) => {
      await trx
        .update(subscriptions)
        .set({ status, updatedAt: nowISO() })
        .where(eq(subscriptions.id, existing.id));
    },
  );

  revalidatePath(`/tenants/${tenantId}`);
  revalidatePath("/subscriptions");
  return { ok: true };
}

// ---- Plans -----------------------------------------------------------------

export async function savePlan(formData: FormData): Promise<Result> {
  const admin = await requireAdmin();
  const code = String(formData.get("code") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const priceRaw = String(formData.get("priceCents") ?? "").trim();
  const maxUsersRaw = String(formData.get("maxUsers") ?? "").trim();
  const isActive = String(formData.get("isActive") ?? "") === "true";

  if (!isPlanCode(code)) return { error: `"${code}" is not a plan.` };
  if (!name) return { error: "A plan needs a name." };

  const priceCents = priceRaw === "" ? null : Number(priceRaw);
  if (priceCents !== null && (!Number.isInteger(priceCents) || priceCents < 0)) {
    return { error: "Price must be a whole number of cents, or blank for “talk to us”." };
  }
  const maxUsers = maxUsersRaw === "" ? null : Number(maxUsersRaw);
  if (maxUsers !== null && (!Number.isInteger(maxUsers) || maxUsers < 1)) {
    return { error: "Max users must be a whole number of at least 1, or blank for unlimited." };
  }

  const features = Object.fromEntries(
    FEATURE_KEYS.map((key) => [key, formData.get(`feature.${key}`) === "on"]),
  ) as unknown as PlanFeatures;

  const [existing] = await db.select().from(plans).where(eq(plans.code, code)).limit(1);
  if (!existing) return { error: "No such plan." };

  await withAudit(
    admin.id,
    {
      action: "plan.update",
      subjectType: "plan",
      subjectId: code,
      before: {
        name: existing.name,
        priceCents: existing.priceCents,
        maxUsers: existing.maxUsers,
        features: existing.features,
        isActive: existing.isActive,
      },
      after: { name, priceCents, maxUsers, features, isActive },
    },
    async (trx) => {
      await trx
        .update(plans)
        .set({ name, priceCents, maxUsers, features: JSON.stringify(features), isActive })
        .where(eq(plans.code, code));
    },
  );

  revalidatePath("/plans");
  revalidatePath("/subscriptions");
  return { ok: true };
}
