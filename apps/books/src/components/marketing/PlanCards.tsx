import Link from "next/link";
import { PLAN_COPY, BILLING_LIVE, seatLine } from "@/lib/marketing";
import { formatPrice, parseFeatures } from "@cashish/core/plans";
import { publicPlans } from "@/lib/lookups";

/**
 * Prices and limits come from the `plans` table; the prose comes from
 * marketing.ts. Reading them together is what makes it impossible for the page
 * to promise a limit that the enforcement in limits.ts does not apply.
 */
export async function PlanCards({ compact = false }: { compact?: boolean }) {
  const rows = await publicPlans();
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
