import Link from "next/link";
import { FEATURES, FAQ } from "@/lib/marketing";
import { SiteNav, SiteFooter } from "./SiteChrome";
import { HeroDoc } from "./HeroDoc";
import { PlanCards, BillingNotice } from "./PlanCards";

export function Landing({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <div className="mk min-h-screen">
      <SiteNav signedIn={signedIn} />

      {/* Hero. Asymmetric on purpose: the claim on the left, the artefact on the
          right, overlapping the ruled ground so the page has a floor. */}
      <section className="mk-ruled mk-ruled-fade relative overflow-hidden">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:pb-28 lg:pt-24">
          <div>
            <div className="mk-kicker mk-rise">Irish · EUR · cash-basis VAT</div>
            <h1
              className="mk-rise mt-5 text-[2.6rem] leading-[1.05] sm:text-6xl"
              style={{ animationDelay: "60ms" }}
            >
              The books,
              <br />
              <span className="mk-mark">actually sorted</span>.
            </h1>
            <p
              className="mk-rise mt-6 max-w-lg text-lg leading-relaxed text-[color:var(--ink-soft)]"
              style={{ animationDelay: "120ms" }}
            >
              Upload the statement your bank already gives you. cashish categorises it,
              matches the money to your invoices, and works out the VAT — on the cash
              basis, the way a small Irish company actually files.
            </p>

            <div
              className="mk-rise mt-8 flex flex-wrap items-center gap-3"
              style={{ animationDelay: "180ms" }}
            >
              <Link href="/register" className="mk-btn mk-btn-primary">
                Create an account
              </Link>
              <Link href="/pricing" className="mk-btn mk-btn-ghost">
                See pricing
              </Link>
            </div>

            <p
              className="mk-rise mt-4 text-xs text-[color:var(--ink-faint)]"
              style={{ animationDelay: "220ms" }}
            >
              Free while in beta. No card. Your data stays in the EU.
            </p>
          </div>

          <div className="mk-rise lg:translate-y-4" style={{ animationDelay: "240ms" }}>
            <HeroDoc />
          </div>
        </div>
      </section>

      {/* The three numbers that describe the job, set as a ledger strip. */}
      <section className="mk-hairline">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-y-8 px-6 py-10 sm:grid-cols-4">
          {[
            ["220", "bank lines in a first import"],
            ["63", "rules doing the categorising"],
            ["1", "place the VAT figure comes from"],
            ["0", "spreadsheets involved"],
          ].map(([n, label]) => (
            <div key={label}>
              <div className="mk-figure mk-figure-lg text-3xl font-semibold">{n}</div>
              <div className="mt-1 text-xs leading-snug text-[color:var(--ink-faint)]">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features, as an editorial two-column list with hairline rules. */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="mk-kicker">What it does</div>
        <h2 className="mt-4 max-w-2xl text-3xl leading-tight sm:text-4xl">
          Bookkeeping is mostly judgement plus a lot of typing. This removes the typing.
        </h2>

        <div className="mt-12 grid gap-x-14 gap-y-10 md:grid-cols-2">
          {FEATURES.map((f) => (
            <article key={f.title} className="mk-hairline pt-5">
              <div className="mk-kicker">{f.kicker}</div>
              <h3 className="mt-3 text-xl">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[color:var(--ink-soft)]">{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Pricing, inline, so nobody has to go looking for it. */}
      <section id="pricing" className="mk-ruled">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="mk-kicker">Pricing</div>
          <h2 className="mt-4 text-3xl sm:text-4xl">Priced per business, not per invoice.</h2>
          <p className="mt-3 max-w-xl text-[color:var(--ink-soft)]">
            No per-transaction fees and no charge for adding your accountant. If you keep
            books for other people, the last one is for you.
          </p>
          <div className="mt-10">
            <PlanCards />
          </div>
          <BillingNotice />
        </div>
      </section>

      {/* The honest section. An accounting tool that overclaims is worse than one
          that is clear about where it stops. */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="mk-kicker">Straight answers</div>
        <div className="mt-8 grid gap-x-14 gap-y-8 md:grid-cols-2">
          {FAQ.map((item) => (
            <div key={item.q} className="mk-hairline pt-5">
              <h3 className="text-base font-semibold">{item.q}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[color:var(--ink-soft)]">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mk-hairline">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-6 py-16">
          <div>
            <h2 className="text-3xl">Start with one statement.</h2>
            <p className="mt-2 text-[color:var(--ink-soft)]">
              Import it, see the numbers, decide then.
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
