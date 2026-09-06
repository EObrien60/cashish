import type { AccountKind } from "@cashish/core/db";

// ---------------------------------------------------------------------------
// What an account kind means, with no database behind it.
//
// Its own module because the client components need these — a table has to
// know that a credit card balance is money owed — and importing them from
// `lib/accounts.ts` would pull the Postgres driver into the browser bundle
// through `@cashish/core/db`. Which it did, and the page 500'd on `fs`.
// ---------------------------------------------------------------------------

export const ACCOUNT_KIND_LABELS: Record<string, string> = {
  current: "Current",
  savings: "Savings",
  credit_card: "Credit card",
  pocket: "Pocket",
  other: "Other",
};

/** True when a balance on this kind of account is money you OWE, not money you hold. */
export function isLiability(kind: string): boolean {
  return kind === "credit_card";
}

export const ACCOUNT_KINDS: AccountKind[] = [
  "current",
  "savings",
  "credit_card",
  "pocket",
  "other",
];
