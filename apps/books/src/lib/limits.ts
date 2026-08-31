import { eq } from "drizzle-orm";
import { db, first, schema } from "@cashish/core/db";
import { parseFeatures, DEFAULT_FEATURES, type PlanFeatures } from "@cashish/core/plans";
import { BILLING_LIVE } from "./marketing";

// ---------------------------------------------------------------------------
// What a tenant's plan permits.
//
// EVERY GATE HERE IS A NO-OP WHILE `BILLING_LIVE` IS FALSE, and that is the
// point rather than a placeholder: this code can land, be reviewed and be
// tested without changing the experience of a single person using cashish
// today. Turning it on is one flag, taken deliberately, once prices are real.
//
// Limits are read from the `plans` row the tenant's subscription points at, so
// the pricing page and the enforcement cannot disagree — both read the table.
//
// A tenant with no subscription is treated as unlimited, not as blocked. The
// migration backfills every existing tenant, so the only way to reach that
// state is a tenant created outside it; locking such a business out of its own
// books because of a bookkeeping gap on our side would be the wrong failure.
// ---------------------------------------------------------------------------

const { subscriptions, plans, memberships } = schema;

export type Limits = {
  maxUsers: number | null;
  features: PlanFeatures;
  status: string | null;
  planCode: string | null;
};

const UNLIMITED: Limits = {
  maxUsers: null,
  features: { payroll: true, receipts: true, mcp: true, oauth: true },
  status: null,
  planCode: null,
};

export async function limitsFor(tenantId: string): Promise<Limits> {
  if (!BILLING_LIVE) return UNLIMITED;

  const row = first(
    await db
      .select({
        maxUsers: plans.maxUsers,
        features: plans.features,
        status: subscriptions.status,
        planCode: subscriptions.planCode,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.code, subscriptions.planCode))
      .where(eq(subscriptions.tenantId, tenantId))
      .limit(1),
  );

  if (!row) return UNLIMITED;

  // A suspended or cancelled business keeps its data and loses its extras.
  const entitled = row.status === "active" || row.status === "trialing" || row.status === "past_due";

  return {
    maxUsers: row.maxUsers,
    features: entitled ? parseFeatures(row.features) : { ...DEFAULT_FEATURES },
    status: row.status,
    planCode: row.planCode,
  };
}

export class LimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LimitError";
  }
}

/** Throws when adding one more member would exceed the plan. */
export async function assertWithinUserLimit(tenantId: string): Promise<void> {
  if (!BILLING_LIVE) return;

  const { maxUsers } = await limitsFor(tenantId);
  if (maxUsers === null) return;

  const rows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.tenantId, tenantId));

  if (rows.length >= maxUsers) {
    throw new LimitError(
      `This plan covers ${maxUsers} ${maxUsers === 1 ? "person" : "people"} in one business. ` +
        `Move to a larger plan to add another.`,
    );
  }
}

export async function assertFeature(
  tenantId: string,
  feature: keyof PlanFeatures,
): Promise<void> {
  if (!BILLING_LIVE) return;

  const { features } = await limitsFor(tenantId);
  if (!features[feature]) {
    throw new LimitError(`This plan does not include ${feature}.`);
  }
}

/** Non-throwing, for hiding a control the current plan cannot use. */
export async function hasFeature(
  tenantId: string,
  feature: keyof PlanFeatures,
): Promise<boolean> {
  if (!BILLING_LIVE) return true;
  return (await limitsFor(tenantId)).features[feature];
}
