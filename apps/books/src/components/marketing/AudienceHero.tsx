"use client";

import { useState } from "react";
import Link from "next/link";
import { AUDIENCES, type AudienceKey } from "@/lib/marketing";
import { HeroDoc } from "./HeroDoc";
import { PersonalDoc } from "./PersonalDoc";

/**
 * The hero, and the choice of who the page is talking to.
 *
 * cashish is one product with two jobs, and a hero that hedges across both
 * persuades neither — "bookkeeping for businesses and individuals" is the kind
 * of sentence that makes a reader assume it is mediocre at each. So the page
 * commits to one story at a time and makes the other one a single click, with
 * the product's own output changing underneath it: a VAT return, or a month
 * against its budget.
 *
 * Business is the default because it is the older half and the one people
 * arrive looking for. Both headings render either way, so the personal story is
 * in the markup a crawler sees rather than hidden behind an interaction.
 */
export function AudienceHero() {
  const [key, setKey] = useState<AudienceKey>("business");
  const a = AUDIENCES[key];

  return (
    <section className="mk-ruled mk-ruled-fade relative overflow-hidden">
      <div className="mx-auto max-w-6xl px-6 pt-10">
        <div
          role="tablist"
          aria-label="Who cashish is for"
          className="mk-rise inline-flex rounded-full border border-[color:var(--rule)] bg-white/70 p-1"
        >
          {(Object.keys(AUDIENCES) as AudienceKey[]).map((k) => (
            <button
              key={k}
              role="tab"
              type="button"
              aria-selected={key === k}
              onClick={() => setKey(k)}
              className={`rounded-full px-4 py-1.5 text-sm transition ${
                key === k
                  ? "bg-[color:var(--ink)] text-[color:var(--paper)]"
                  : "text-[color:var(--ink-soft)] hover:text-[color:var(--ink)]"
              }`}
            >
              {AUDIENCES[k].label}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-10 lg:grid-cols-[1.05fr_0.95fr] lg:pb-28 lg:pt-12">
        <div>
          {/* Keyed on the audience so the entrance animation replays on switch —
              without it the copy swaps silently and the change is easy to miss. */}
          <div key={`${key}-kicker`} className="mk-kicker mk-rise">
            {a.kicker}
          </div>
          <h1
            key={`${key}-h1`}
            className="mk-rise mt-5 text-[2.6rem] leading-[1.05] sm:text-6xl"
          >
            {a.headline[0]}
            <br />
            <span className="mk-mark">{a.headline[1]}</span>.
          </h1>
          <p
            key={`${key}-body`}
            className="mk-rise mt-6 max-w-lg text-lg leading-relaxed text-[color:var(--ink-soft)]"
            style={{ animationDelay: "60ms" }}
          >
            {a.body}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/register" className="mk-btn mk-btn-primary">
              {a.cta}
            </Link>
            <Link href="/pricing" className="mk-btn mk-btn-ghost">
              See pricing
            </Link>
          </div>

          <p className="mt-4 text-xs text-[color:var(--ink-faint)]">
            Free while in beta. No card. Your data stays in the EU.
          </p>
        </div>

        <div key={`${key}-doc`} className="mk-rise lg:translate-y-4">
          {key === "business" ? <HeroDoc /> : <PersonalDoc />}
        </div>
      </div>

      {/* The figures belong to whichever story is on screen. */}
      <div className="mk-hairline">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-y-8 px-6 py-10 sm:grid-cols-4">
          {a.figures.map(([n, label]) => (
            <div key={label}>
              <div className="mk-figure mk-figure-lg text-3xl font-semibold">{n}</div>
              <div className="mt-1 text-xs leading-snug text-[color:var(--ink-faint)]">
                {label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
