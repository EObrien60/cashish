"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { money } from "@/lib/format";
import { Card } from "./ui";
import { generateReportAction } from "@/app/actions";
import type { FactSheet } from "@/lib/insights";
import type { AiReport } from "@/lib/ai-report";

// The facts are rendered by the app. The model chooses which of them to talk
// about and which chart helps — it supplies no data points, so a chart here
// cannot disagree with the ledger it came from.

function Bars({
  rows,
  currency,
}: {
  rows: { label: string; value: number; sub?: string }[];
  currency: string;
}) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3 text-sm">
          <span className="w-40 shrink-0 truncate" title={r.label}>
            {r.label}
          </span>
          <span className="h-2 flex-1 rounded-full bg-black/[0.06]">
            <span
              className="block h-full rounded-full bg-brand/70"
              style={{ width: `${(Math.abs(r.value) / max) * 100}%` }}
            />
          </span>
          <span className="w-24 shrink-0 text-right tabular-nums">{money(r.value)}</span>
          {r.sub && <span className="w-20 shrink-0 text-right text-xs text-ink-faint">{r.sub}</span>}
        </div>
      ))}
    </div>
  );
}

function MonthBars({ facts }: { facts: FactSheet }) {
  const max = Math.max(1, ...facts.months.map((m) => Math.max(m.in, m.out)));
  return (
    <div className="flex h-40 items-end gap-2">
      {facts.months.map((m) => (
        <div key={m.month} className="flex h-full flex-1 flex-col items-center gap-1">
          <div className="flex w-full flex-1 items-end justify-center gap-[3px]">
            <div
              className="w-1/2 rounded-t bg-money-in/80"
              style={{ height: `${(m.in / max) * 100}%` }}
              title={`in ${money(m.in)}`}
            />
            <div
              className="w-1/2 rounded-t bg-money-out/70"
              style={{ height: `${(m.out / max) * 100}%` }}
              title={`out ${money(m.out)}`}
            />
          </div>
          <span className="text-[10px] text-ink-faint">{m.month.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

function Chart({ series, facts }: { series: string; facts: FactSheet }) {
  if (series === "months") return <MonthBars facts={facts} />;
  if (series === "categories")
    return (
      <Bars
        currency={facts.currency}
        rows={facts.categories
          .filter((c) => c.kind === "expense")
          .slice(0, 8)
          .map((c) => ({
            label: c.category,
            value: c.total,
            sub: c.change == null ? undefined : `${c.change >= 0 ? "+" : ""}${money(c.change)}`,
          }))}
      />
    );
  if (series === "merchants")
    return (
      <Bars
        currency={facts.currency}
        rows={facts.merchants.slice(0, 10).map((m) => ({
          label: m.label,
          value: m.total,
          sub: `${m.count}×`,
        }))}
      />
    );
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {facts.position.map((p) => (
        <div key={p.currency} className="rounded-lg border border-line p-3">
          <div className="text-xs uppercase tracking-wide text-ink-faint">{p.currency}</div>
          <div className="text-lg font-bold">{money(p.net)}</div>
          <div className="text-xs text-ink-faint">
            {money(p.held)} held · {money(p.owed)} owed
          </div>
        </div>
      ))}
    </div>
  );
}

export function InsightsView({
  facts,
  period,
  aiAvailable,
}: {
  facts: FactSheet;
  period: { from: string; to: string; label: string };
  aiAvailable: boolean;
}) {
  const [, start] = useTransition();
  const [report, setReport] = useState<AiReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const topExpense = facts.categories.filter((c) => c.kind === "expense").slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <div className="text-xs uppercase tracking-wide text-ink-faint">In</div>
          <div className="text-2xl font-bold mt-1 text-money-in">{money(facts.totals.in)}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-ink-faint">Out</div>
          <div className="text-2xl font-bold mt-1 text-money-out">{money(facts.totals.out)}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-ink-faint">Net</div>
          <div className={`text-2xl font-bold mt-1 ${facts.totals.net < 0 ? "text-money-out" : ""}`}>
            {money(facts.totals.net)}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-ink-faint">Moved, not spent</div>
          <div className="text-2xl font-bold mt-1">{money(facts.totals.movedBetweenAccounts)}</div>
          <div className="text-sm text-ink-faint mt-1">between your own accounts</div>
        </Card>
      </div>

      {facts.totals.uncategorisedCount > 0 && (
        <Card className="border-amber-300/50">
          <p className="text-sm">
            <strong>{money(facts.totals.uncategorisedOut)}</strong> of spending across{" "}
            {facts.totals.uncategorisedCount} transaction
            {facts.totals.uncategorisedCount === 1 ? "" : "s"} is in no category, so it is missing
            from the breakdown below.{" "}
            <Link href="/rules" className="underline">
              Let cashish suggest rules for it
            </Link>
            .
          </p>
        </Card>
      )}

      <Card>
        <h2 className="font-semibold mb-3">Month by month</h2>
        <MonthBars facts={facts} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold mb-3">Where it went</h2>
          {topExpense.length === 0 ? (
            <p className="text-sm text-ink-faint">Nothing categorised as spending yet.</p>
          ) : (
            <Bars
              currency={facts.currency}
              rows={topExpense.map((c) => ({
                label: c.category,
                value: c.total,
                sub: c.change == null ? undefined : `${c.change >= 0 ? "+" : ""}${money(c.change)}`,
              }))}
            />
          )}
        </Card>
        <Card>
          <h2 className="font-semibold mb-3">Who got it</h2>
          {facts.merchants.length === 0 ? (
            <p className="text-sm text-ink-faint">No spending in this period.</p>
          ) : (
            <Bars
              currency={facts.currency}
              rows={facts.merchants.slice(0, 10).map((m) => ({
                label: m.label,
                value: m.total,
                sub: `${m.count}×`,
              }))}
            />
          )}
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">What it means</h2>
            <p className="text-sm text-ink-faint mt-0.5">
              Written from the figures above, which the app computed. It quotes them; it does not
              recalculate them.
            </p>
          </div>
          <button
            className="btn-primary"
            disabled={busy || !aiAvailable}
            title={aiAvailable ? undefined : "No AI credentials on this deployment"}
            onClick={() => {
              setBusy(true);
              setError(null);
              start(async () => {
                const r = await generateReportAction(period.from, period.to);
                if (r.ok) setReport(r.value.report);
                else setError(r.reason);
                setBusy(false);
              });
            }}
          >
            {busy ? "Reading your books…" : report ? "Write it again" : "Explain this period"}
          </button>
        </div>

        {!aiAvailable && (
          <p className="mt-3 text-sm text-ink-faint">
            Set <code>AI_GATEWAY_API_KEY</code>, or enable AI Gateway on the Vercel project so OIDC
            provides one. Everything above works without it.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-money-out">{error}</p>}

        {report && (
          <div className="mt-4 space-y-5">
            <p className="text-lg font-medium">{report.headline}</p>
            {report.sections.map((s, i) => (
              <div key={i}>
                <h3 className="font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-ink-soft">{s.body}</p>
                {s.chart && (
                  <div className="mt-3 rounded-lg border border-line p-3">
                    <div className="mb-2 text-xs uppercase tracking-wide text-ink-faint">
                      {s.chart.title}
                    </div>
                    <Chart series={s.chart.series} facts={facts} />
                  </div>
                )}
              </div>
            ))}
            {report.watchOut.length > 0 && (
              <div className="rounded-lg border border-amber-300/50 bg-amber-50/40 p-3">
                <h3 className="font-semibold">Worth a look</h3>
                <ul className="mt-1 list-disc pl-5 text-sm text-ink-soft">
                  {report.watchOut.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
