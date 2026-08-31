/**
 * Plans: the types, and the values the first migration seeds.
 *
 * The database is the source of truth (a price or a limit is something the
 * admin console changes, not something a deploy changes). What lives here is
 * the shape both applications agree on, plus the seed so that a fresh
 * deployment has the three plans without anyone typing SQL.
 *
 * A plan describes ONE SET OF BOOKS. Subscriptions are per tenant, so what
 * separates the plans is how many people may be in one business and which
 * features that business gets — not how many businesses you may own.
 */

export const PLAN_CODES = ["sole", "company", "practice"] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "cancelled",
  "suspended",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Everything a plan can switch off. Absent means false. */
export type PlanFeatures = {
  payroll: boolean;
  receipts: boolean;
  mcp: boolean;
  oauth: boolean;
};

export const FEATURE_KEYS = ["payroll", "receipts", "mcp", "oauth"] as const;

export const DEFAULT_FEATURES: PlanFeatures = {
  payroll: false,
  receipts: false,
  mcp: false,
  oauth: false,
};

export type SeedPlan = {
  code: PlanCode;
  name: string;
  /** Integer cents per business per month. Null means "talk to us". */
  priceCents: number | null;
  cadence: string;
  /** Members permitted in one set of books. Null means unlimited. */
  maxUsers: number | null;
  features: PlanFeatures;
  sortOrder: number;
};

export const SEED_PLANS: SeedPlan[] = [
  {
    code: "sole",
    name: "Sole trader",
    priceCents: 900,
    cadence: "month",
    maxUsers: 1,
    features: { payroll: false, receipts: false, mcp: false, oauth: false },
    sortOrder: 0,
  },
  {
    code: "company",
    name: "Company",
    priceCents: 2900,
    cadence: "month",
    maxUsers: null,
    features: { payroll: true, receipts: true, mcp: true, oauth: false },
    sortOrder: 1,
  },
  {
    code: "practice",
    name: "Practice",
    priceCents: null,
    cadence: "month",
    maxUsers: null,
    features: { payroll: true, receipts: true, mcp: true, oauth: true },
    sortOrder: 2,
  },
];

export function isPlanCode(value: unknown): value is PlanCode {
  return typeof value === "string" && (PLAN_CODES as readonly string[]).includes(value);
}

export function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return (
    typeof value === "string" && (SUBSCRIPTION_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Parses the `features` JSON column.
 *
 * Tolerant on purpose: an unparseable or partial value yields "no features"
 * rather than throwing. A malformed row should cost a customer a feature they
 * can ask about, not take the whole page down.
 */
export function parseFeatures(json: string | null | undefined): PlanFeatures {
  if (!json) return { ...DEFAULT_FEATURES };
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    return {
      payroll: raw.payroll === true,
      receipts: raw.receipts === true,
      mcp: raw.mcp === true,
      oauth: raw.oauth === true,
    };
  } catch {
    return { ...DEFAULT_FEATURES };
  }
}

/** Formats cents as the pricing page shows them. Null becomes an empty string. */
export function formatPrice(priceCents: number | null): string {
  if (priceCents === null) return "";
  return priceCents % 100 === 0
    ? `€${priceCents / 100}`
    : `€${(priceCents / 100).toFixed(2)}`;
}
