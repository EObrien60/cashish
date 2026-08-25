import Link from "next/link";
import { redirect } from "next/navigation";
import { currentSession } from "@/lib/session";
import { register } from "../auth-actions";
import { SiteNav } from "@/components/marketing/SiteChrome";
import { RegisterForm } from "@/components/marketing/RegisterForm";
import { BILLING_LIVE } from "@/lib/marketing";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  // Already a member: there is nothing to sign up for.
  if (await currentSession()) redirect("/");

  return (
    <div className="mk min-h-screen">
      <SiteNav />
      <section className="mk-ruled mk-ruled-fade">
        <div className="mx-auto grid max-w-5xl gap-12 px-6 pb-24 pt-14 lg:grid-cols-[0.95fr_1.05fr]">
          <div>
            <div className="mk-kicker">Create an account</div>
            <h1 className="mk-rise mt-4 text-4xl leading-tight">
              Your books, in about a minute.
            </h1>
            <p className="mk-rise mt-4 text-[color:var(--ink-soft)]" style={{ animationDelay: "60ms" }}>
              You get your own business to work in, seeded with the Irish VAT rates and a
              usable chart of accounts. Add a statement whenever you are ready.
            </p>

            <ul className="mt-8 space-y-3 text-sm">
              {[
                "You own the business you create, and can add more later",
                "Invite your accountant with their own login and role",
                BILLING_LIVE
                  ? "14 days free, then whichever plan fits"
                  : "Free while in beta — no card is taken",
                "Data stored in the EU; export it whenever you like",
              ].map((line) => (
                <li key={line} className="flex gap-2.5">
                  <span aria-hidden className="text-[color:var(--brand)]">
                    ✓
                  </span>
                  <span className="text-[color:var(--ink-soft)]">{line}</span>
                </li>
              ))}
            </ul>

            <p className="mk-hairline mt-8 pt-4 text-xs leading-relaxed text-[color:var(--ink-faint)]">
              cashish works out your figures; you review and file them. It is not a
              Revenue-approved filing service.
            </p>
          </div>

          <div className="mk-rise" style={{ animationDelay: "120ms" }}>
            <RegisterForm action={register} />
            <p className="mt-4 text-center text-sm text-[color:var(--ink-faint)]">
              Already have an account?{" "}
              <Link href="/login" className="font-medium text-[color:var(--brand-dark)] hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
