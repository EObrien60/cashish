import Link from "next/link";
import { FEATURES, FAQ, type Audience } from "@/lib/marketing";
import { SiteNav, SiteFooter } from "./SiteChrome";
import { AudienceHero } from "./AudienceHero";
import { PlanCards, PersonalPlanCard, BillingNotice } from "./PlanCards";

/** What each half of the app is, said plainly, side by side. */
const SPLIT: { title: string; blurb: string; shared: string[] }[] = [
  {
    title: "A business",
    blurb:
      "The trading half: invoices out, bills in, VAT worked out on the cash basis, " +
      "payroll if you have people.",
    shared: [
      "Invoices, recurring invoices and contracts",
      "Customers, products and vendors",
      "VAT 3 figures — T1, T2 and the balance",
      "Irish PAYE payroll, RPN import and payslips",
    ],
  },
  {
    title: "Yourself",
    blurb:
      "The same ledger with the trading half switched off, and a budget in its " +
      "place. Nobody to invoice, no VAT to file.",
    shared: [
      "A budget per category, against what you spent",
      "Credit cards and savings alongside the current account",
      "Where it went, month by month",
      "Savings balances over time",
    ],
  },
];

const AUDIENCE_TAG: Record<Audience, string | null> = {
  both: null,
  business: "Business",
  personal: "Personal",
};

export function Landing({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <div className="mk min-h-screen">
      <SiteNav signedIn={signedIn} />

      <AudienceHero />

      {/* One product, two jobs — stated early, because a visitor who arrived for
          one needs to know the other is not an afterthought bolted on. */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="mk-kicker">One ledger, two jobs</div>
        <h2 className="mt-4 max-w-3xl text-3xl leading-tight sm:text-4xl">
          The same books, whether the money is the company&rsquo;s or yours.
        </h2>
        <p className="mt-4 max-w-2xl text-[color:var(--ink-soft)]">
          Importing, categorisation rules, accounts, documents and reporting are one
          piece of software. What changes is which half is switched on — and a book of
          each kind stays entirely separate from the other, under one login.
        </p>

        <div className="mt-12 grid gap-x-14 gap-y-10 md:grid-cols-2">
          {SPLIT.map((s) => (
            <article key={s.title} className="mk-hairline pt-5">
              <h3 className="mk-display text-2xl">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[color:var(--ink-soft)]">
                {s.blurb}
              </p>
              <ul className="mt-4 space-y-2 text-sm">
                {s.shared.map((line) => (
                  <li key={line} className="flex gap-2.5">
                    <span aria-hidden className="text-[color:var(--brand)]">
                      ✓
                    </span>
                    <span className="text-[color:var(--ink-soft)]">{line}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <p className="mk-hairline mt-10 pt-5 text-sm text-[color:var(--ink-soft)]">
          <strong className="font-semibold">Shared by both:</strong> statement import and
          de-duplication, categorisation rules that apply retroactively, multiple accounts
          with transfer detection, document reading, &ldquo;where it went&rdquo;, and MCP
          access for an AI agent.
        </p>
      </section>

      {/* Features, tagged rather than split into two lists. */}
      <section className="mk-ruled">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="mk-kicker">What it does</div>
          <h2 className="mt-4 max-w-2xl text-3xl leading-tight sm:text-4xl">
            Bookkeeping is mostly judgement plus a lot of typing. This removes the typing.
          </h2>

          <div className="mt-12 grid gap-x-14 gap-y-10 md:grid-cols-2">
            {FEATURES.map((f) => (
              <article key={f.title} className="mk-hairline pt-5">
                <div className="flex items-center gap-2.5">
                  <div className="mk-kicker">{f.kicker}</div>
                  {AUDIENCE_TAG[f.for] && (
                    <span className="rounded-full border border-[color:var(--rule)] bg-white px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-[color:var(--ink-faint)]">
                      {AUDIENCE_TAG[f.for]} only
                    </span>
                  )}
                </div>
                <h3 className="mt-3 text-xl">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[color:var(--ink-soft)]">
                  {f.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing. Personal sits apart from the business tiers rather than beside
          them — it is a different job, not a cheaper version of the same one. */}
      <section id="pricing" className="mx-auto max-w-6xl px-6 py-20">
        <div className="mk-kicker">Pricing</div>
        <h2 className="mt-4 text-3xl sm:text-4xl">One price per set of books.</h2>
        <p className="mt-3 max-w-xl text-[color:var(--ink-soft)]">
          No per-transaction fees and no charge for adding your accountant. A personal
          book is priced on its own, because a household is a different job from a
          company rather than a smaller one.
        </p>

        <div className="mt-10">
          <PersonalPlanCard />
        </div>

        <h3 className="mk-display mt-14 text-2xl">For a business</h3>
        <p className="mt-2 max-w-xl text-sm text-[color:var(--ink-soft)]">
          What separates these is how many people may work in one business and what that
          business can do — never how many businesses you may own.
        </p>
        <div className="mt-6">
          <PlanCards />
        </div>
        <BillingNotice />
      </section>

      {/* The honest section. An accounting tool that overclaims is worse than one
          that is clear about where it stops. */}
      <section className="mk-ruled">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="mk-kicker">Straight answers</div>
          <div className="mt-8 grid gap-x-14 gap-y-8 md:grid-cols-2">
            {FAQ.map((item) => (
              <div key={item.q} className="mk-hairline pt-5">
                <h3 className="text-base font-semibold">{item.q}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[color:var(--ink-soft)]">
                  {item.a}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-hairline">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-6 py-16">
          <div>
            <h2 className="text-3xl">Start with one statement.</h2>
            <p className="mt-2 text-[color:var(--ink-soft)]">
              Your company&rsquo;s or your own. Import it, see the numbers, decide then.
            </p>
          </div>
          <Link href="/register" className="mk-btn mk-btn-primary">
            Create an account
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
