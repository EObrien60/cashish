import { eq, desc } from "drizzle-orm";
import { db, schema } from "@cashish/core/db";
import { parseFeatures, type PlanFeatures } from "@cashish/core/plans";

const { subscriptions, tenants, plans } = schema;

export type SubscriptionRow = {
  id: string;
  tenantId: string;
  slug: string;
  tenantName: string;
  planCode: string;
  planName: string;
  priceCents: number | null;
  status: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  note: string;
  updatedAt: string;
};

export async function listSubscriptions(): Promise<SubscriptionRow[]> {
  return db
    .select({
      id: subscriptions.id,
      tenantId: subscriptions.tenantId,
      slug: tenants.slug,
      tenantName: tenants.name,
      planCode: subscriptions.planCode,
      planName: plans.name,
      priceCents: plans.priceCents,
      status: subscriptions.status,
      trialEndsAt: subscriptions.trialEndsAt,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      note: subscriptions.note,
      updatedAt: subscriptions.updatedAt,
    })
    .from(subscriptions)
    .innerJoin(tenants, eq(tenants.id, subscriptions.tenantId))
    .innerJoin(plans, eq(plans.code, subscriptions.planCode))
    .orderBy(desc(subscriptions.updatedAt));
}

export type PlanView = {
  code: string;
  name: string;
  priceCents: number | null;
  cadence: string;
  maxUsers: number | null;
  features: PlanFeatures;
  isActive: boolean;
  sortOrder: number;
  subscriberCount: number;
};

export async function listPlansWithCounts(): Promise<PlanView[]> {
  const rows = await db.select().from(plans).orderBy(plans.sortOrder);
  const subs = await db.select({ planCode: subscriptions.planCode }).from(subscriptions);
  const counts = new Map<string, number>();
  for (const sub of subs) counts.set(sub.planCode, (counts.get(sub.planCode) ?? 0) + 1);

  return rows.map((row) => ({
    code: row.code,
    name: row.name,
    priceCents: row.priceCents,
    cadence: row.cadence,
    maxUsers: row.maxUsers,
    features: parseFeatures(row.features),
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    subscriberCount: counts.get(row.code) ?? 0,
  }));
}
