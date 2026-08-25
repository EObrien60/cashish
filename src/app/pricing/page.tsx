import Link from "next/link";
import { currentSession } from "@/lib/session";
import { FAQ } from "@/lib/marketing";
import { SiteNav, SiteFooter } from "@/components/marketing/SiteChrome";
import { PlanCards, BillingNotice } from "@/components/marketing/PlanCards";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const session = await currentSession();
  return (
    <div className="mk min-h-screen">
      <SiteNav signedIn={!!session} />
      <section className="mk-ruled mk-ruled-fade">
        <div className="mx-auto max-w-6xl px-6 pb-16 pt-14">
          <div className="mk-kicker">Pricing</div>
          <h1 className="mk-rise mt-4 max-w-2xl text-4xl leading-tight sm:text-5xl">
            One price per business. Everything in it.
          </h1>
          <p className="mk-rise mt-4 max-w-xl text-[color:var(--ink-soft)]" style={{ animationDelay: "60ms" }}>
            No per-transaction charge, no fee for inviting your accountant, no add-on for
            the VAT return. The only thing that changes between plans is how many sets of
            books you keep.
          </p>
          <div className="mt-12">
            <PlanCards />
          </div>
          <BillingNotice />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="mk-kicker">Before you ask</div>
        <div className="mt-8 grid gap-x-14 gap-y-8 md:grid-cols-2">
          {FAQ.map((item) => (
            <div key={item.q} className="mk-hairline pt-5">
              <h3 className="text-base font-semibold">{item.q}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[color:var(--ink-soft)]">{item.a}</p>
            </div>
          ))}
        </div>
        <div className="mk-hairline mt-14 flex flex-wrap items-center justify-between gap-4 pt-8">
          <p className="text-[color:var(--ink-soft)]">Import a statement and see for yourself.</p>
          <Link href="/register" className="mk-btn mk-btn-primary">
            Create an account
          </Link>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
