import Link from "next/link";
import { PLAN_COPY, BILLING_LIVE, seatLine } from "@/lib/marketing";
import {
  formatPrice,
  parseFeatures,
  BUSINESS_PLAN_CODES,
  PERSONAL_PLAN_CODE,
} from "@cashish/core/plans";
import { publicPlans } from "@/lib/lookups";

/**
 * Prices and limits come from the `plans` table; the prose comes from
 * marketing.ts. Reading them together is what makes it impossible for the page
 * to promise a limit that the enforcement in limits.ts does not apply.
 */
export async function PlanCards({ compact = false }: { compact?: boolean }) {
  const all = await publicPlans();
  // The business tiers only. Personal is rendered by PersonalPlanCard, apart
  // from these, so nobody is invited to read a grocery budget as a fourth tier
  // of a company plan.
  const rows = all.filter((row) =>
    (BUSINESS_PLAN_CODES as readonly string[]).includes(row.code),
  );
  const plans = rows.map((row, index) => {
    const copy = PLAN_COPY.find((c) => c.code === row.code);
    return {
      id: row.code,
      name: row.name,
      price: row.priceCents === null ? null : formatPrice(row.priceCents).replace("€", ""),
      cadence: `per business, per ${row.cadence}`,
      limits: seatLine(row.maxUsers),
      pitch: copy?.pitch ?? "",
      includes: copy?.includes ?? [],
      best: copy?.best ?? false,
      features: parseFeatures(row.features),
      index,
    };
  });

  return (
    <div className={`grid gap-4 ${compact ? "lg:grid-cols-3" : "md:grid-cols-3"}`}>
      {plans.map((plan, i) => (
        <div
          key={plan.id}
          className={`mk-plan mk-rise ${plan.best ? "mk-plan-best" : ""}`}
          style={{ animationDelay: `${80 * i}ms` }}
        >
          <div className="mk-kicker">{plan.best ? "Most businesses" : plan.name}</div>
          <div className="mt-3 mk-display text-xl">{plan.name}</div>

          <div className="mt-3 flex items-baseline gap-1.5">
            {plan.price === null ? (
              <span className="mk-display text-3xl">Let’s talk</span>
            ) : (
              <>
                <span className="mk-figure mk-figure-lg text-4xl font-semibold">€{plan.price}</span>
                <span
                  className={`text-xs ${
                    plan.best ? "text-white/55" : "text-[color:var(--ink-faint)]"
                  }`}
                >
                  {plan.cadence}
                </span>
              </>
            )}
          </div>

          <p
            className={`mt-3 text-sm leading-relaxed ${
              plan.best ? "text-white/70" : "text-[color:var(--ink-soft)]"
            }`}
          >
            {plan.pitch}
          </p>

          <ul className="mt-5 space-y-2 text-sm">
            {plan.includes.map((line) => (
              <li key={line} className="flex gap-2.5">
                <span
                  aria-hidden
                  className={plan.best ? "text-[#7fd0b4]" : "text-[color:var(--brand)]"}
                >
                  ✓
                </span>
                <span className={plan.best ? "text-white/85" : "text-[color:var(--ink-soft)]"}>
                  {line}
                </span>
              </li>
            ))}
          </ul>

          {plan.limits && (
            <p
              className={`mt-4 text-xs ${
                plan.best ? "text-white/45" : "text-[color:var(--ink-faint)]"
              }`}
            >
              {plan.limits}
            </p>
          )}

          <div className="mt-auto pt-6">
            {plan.price === null ? (
              <a
                href="mailto:hello@cashish.ie?subject=cashish%20for%20a%20practice"
                className={`mk-btn w-full ${plan.best ? "mk-btn-primary" : "mk-btn-ghost"}`}
              >
                Get in touch
              </a>
            ) : (
              <Link
                href="/register"
                className={`mk-btn w-full ${
                  plan.best
                    ? "bg-[#f4f2ea] text-[color:var(--ink)] hover:bg-white"
                    : "mk-btn-primary"
                }`}
              >
                {BILLING_LIVE ? "Start free trial" : "Start free"}
              </Link>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The personal plan, on its own.
 *
 * Wide rather than a column, because it is not competing with the business
 * tiers — it is the other product. Reads from the same `plans` table, so the
 * price here is the price the admin console sets and nothing is hardcoded.
 */
export async function PersonalPlanCard() {
  const rows = await publicPlans();
  const row = rows.find((r) => r.code === PERSONAL_PLAN_CODE);
  if (!row) return null;
  const copy = PLAN_COPY.find((c) => c.code === PERSONAL_PLAN_CODE);
  const price = row.priceCents === null ? null : formatPrice(row.priceCents);

  return (
    <div className="mk-plan mk-rise !flex-row flex-wrap items-start gap-x-12 gap-y-6 sm:p-8">
      <div className="min-w-[240px] flex-1">
        <div className="mk-kicker">For yourself</div>
        <div className="mk-display mt-3 text-2xl">{row.name}</div>
        <div className="mt-3 flex items-baseline gap-1.5">
          {price === null ? (
            <span className="mk-display text-3xl">Free</span>
          ) : (
            <>
              <span className="mk-figure mk-figure-lg text-4xl font-semibold">{price}</span>
              <span className="text-xs text-[color:var(--ink-faint)]">
                per book, per {row.cadence}
              </span>
            </>
          )}
        </div>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-[color:var(--ink-soft)]">
          {copy?.pitch}
        </p>
        <p className="mt-3 text-xs text-[color:var(--ink-faint)]">
          {row.maxUsers === null
            ? "Everyone in the household."
            : row.maxUsers === 1
              ? "One person."
              : `Up to ${row.maxUsers} people — a household, not a company.`}
        </p>
        <div className="mt-6">
          <Link href="/register" className="mk-btn mk-btn-primary">
            {BILLING_LIVE ? "Start free trial" : "Start free"}
          </Link>
        </div>
      </div>

      <ul className="min-w-[260px] flex-1 space-y-2 text-sm">
        {(copy?.includes ?? []).map((line) => (
          <li key={line} className="flex gap-2.5">
            <span aria-hidden className="text-[color:var(--brand)]">
              ✓
            </span>
            <span className="text-[color:var(--ink-soft)]">{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Says out loud that nothing is charged yet.
 *
 * Showing prices while taking no card is only misleading if you do not mention
 * it, and quietly implying a paywall that does not exist would be the wrong kind
 * of surprise on first invoice.
 */
export function BillingNotice() {
  if (BILLING_LIVE) return null;
  return (
    <div className="mk-hairline mt-8 flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-4 text-sm">
      <span className="font-medium">Billing is not switched on yet.</span>
      <span className="text-[color:var(--ink-soft)]">
        Every plan is free while cashish is in beta — no card is taken anywhere, and the
        prices above are what is planned rather than what is charged.
      </span>
    </div>
  );
}
