import Link from "next/link";
import { withTenant } from "@/lib/request-context";
import { profitAndLoss, monthlyCashflow } from "@/lib/reports";
import { marginReport, spendReport, revenueReport, trendReport } from "@/lib/analysis";
import { resolvePeriod } from "@/lib/period";
import { money, fmtDate } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui";
import { PeriodTabs } from "@/components/PeriodTabs";
import { CashflowChart } from "@/components/BarChart";
import {
  Delta,
  MetricCard,
  ShareBar,
  BasisNote,
  UncategorisedWarning,
} from "@/components/ReportBits";

export const dynamic = "force-dynamic";

const pct = (n: number) => `${n.toFixed(1)}%`;
const monthLabel = (m: string) => {
  const [y, mm] = m.split("-");
  return `${["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(mm)]} ${y.slice(2)}`;
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  return withTenant(async () => {
    const sp = await searchParams;
    const period = resolvePeriod(sp.period);

    const [pnl, monthly, margins, spend, revenue, trend] = await Promise.all([
      profitAndLoss(period.from, period.to),
      monthlyCashflow(period.from, period.to),
      marginReport(period.from, period.to),
      spendReport(period.from, period.to),
      revenueReport(period.from, period.to),
      trendReport(period.from, period.to),
    ]);

    const { now, before, change, prior } = margins;
    const maxSpend = spend.lines[0]?.amount ?? 0;
    const maxCounterparty = spend.counterparties[0]?.amount ?? 0;
    const maxRevenue = revenue.customers[0]?.invoiced ?? 0;

    return (
      <div>
        <PageHeader
          title="Reports"
          subtitle="Margins, where the money goes, and who it comes from — straight from your ledger."
        />
        <div className="mb-6">
          <PeriodTabs active={period.key} basePath="/reports" />
        </div>

        {/* ---- headline margins ---- */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Revenue"
            value={money(now.revenue)}
            tone="in"
            delta={<Delta value={change.revenue} />}
            hint="vs prior period"
          />
          <MetricCard
            label="Gross profit"
            value={money(now.grossProfit)}
            tone={now.grossProfit >= 0 ? "in" : "out"}
            delta={<Delta value={change.grossProfit} />}
            hint={`${pct(now.grossMarginPct)} margin`}
          />
          <MetricCard
            label="Gross margin"
            value={pct(now.grossMarginPct)}
            delta={<Delta value={change.grossMarginPts} unit="pts" />}
            hint={`was ${pct(before.grossMarginPct)}`}
          />
          <MetricCard
            label="Operating profit"
            value={money(now.operatingProfit)}
            tone={now.operatingProfit >= 0 ? "in" : "out"}
            delta={<Delta value={change.netMarginPts} unit="pts" />}
            hint={`${pct(now.netMarginPct)} of revenue`}
          />
        </div>

        <UncategorisedWarning
          count={now.uncategorised.count}
          income={now.uncategorised.income}
          expense={now.uncategorised.expense}
        />

        {/* ---- the margin stack ---- */}
        <Card className="mt-4 p-5">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">How revenue becomes profit</h2>
            <span className="text-xs text-ink-faint">
              {fmtDate(period.from)} – {fmtDate(period.to)} · compared with{" "}
              {fmtDate(prior.from)} – {fmtDate(prior.to)}
            </span>
          </div>

          <div className="divide-y divide-line text-sm">
            {[
              { label: "Revenue", value: now.revenue, prior: before.revenue, strong: true },
              {
                label: "less Cost of sales",
                value: -now.costOfSales,
                prior: -before.costOfSales,
                sub: `${pct(now.revenue ? (now.costOfSales / now.revenue) * 100 : 0)} of revenue`,
              },
              {
                label: "Gross profit",
                value: now.grossProfit,
                prior: before.grossProfit,
                strong: true,
                sub: pct(now.grossMarginPct),
              },
              {
                label: "less Overheads",
                value: -now.overheads,
                prior: -before.overheads,
                sub: `${pct(now.revenue ? (now.overheads / now.revenue) * 100 : 0)} of revenue`,
              },
              {
                label: "Operating profit",
                value: now.operatingProfit,
                prior: before.operatingProfit,
                strong: true,
                sub: pct(now.netMarginPct),
              },
            ].map((row) => (
              <div
                key={row.label}
                className={`flex items-baseline justify-between gap-4 py-2.5 ${
                  row.strong ? "font-semibold" : ""
                }`}
              >
                <span className={row.strong ? "" : "pl-4 text-ink-soft"}>
                  {row.label}
                  {row.sub && (
                    <span className="ml-2 text-xs font-normal text-ink-faint">{row.sub}</span>
                  )}
                </span>
                <span className="flex items-baseline gap-3">
                  <span className="text-xs font-normal text-ink-faint tabular">
                    {money(Math.abs(row.prior))}
                  </span>
                  <span
                    className={`tabular ${
                      row.value < 0 ? "text-money-out" : row.strong ? "text-money-in" : ""
                    }`}
                  >
                    {money(Math.abs(row.value))}
                  </span>
                </span>
              </div>
            ))}
          </div>

          <BasisNote>
            Cash basis: these are bank movements in the period, not accruals. Stock bought
            in one month and sold in the next squeezes that month&rsquo;s gross margin and
            flatters the following one — worth remembering before reading much into a single
            month. Cost of sales is whichever categories are marked as such in Settings.
          </BasisNote>
        </Card>

        {/* ---- where the money goes ---- */}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="font-semibold">Where the money goes</h2>
              <span className="flex items-baseline gap-2">
                <span className="tabular font-bold text-money-out">{money(spend.total)}</span>
                <Delta value={spend.changePct} goodWhenUp={false} />
              </span>
            </div>
            {spend.lines.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-faint">No spending in this period.</p>
            ) : (
              <div className="space-y-3">
                {spend.lines.map((l) => (
                  <div key={l.categoryId ?? "uncat"}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate">
                        {l.name}
                        {l.costOfSales && (
                          <span className="ml-1.5 text-[10px] uppercase tracking-wide text-ink-faint">
                            direct
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-baseline gap-2.5">
                        <span className="text-xs text-ink-faint">{pct(l.sharePct)}</span>
                        <Delta value={l.changePct} goodWhenUp={false} />
                        <span className="tabular font-medium">{money(l.amount)}</span>
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <ShareBar value={l.amount} max={maxSpend} color={l.color} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <BasisNote>
              Percentages are share of total spend. The arrow compares with the same length
              of time immediately before this period.
            </BasisNote>
          </Card>

          <Card className="p-5">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="font-semibold">Who you paid</h2>
              <span className="text-xs text-ink-faint">top {spend.counterparties.length}</span>
            </div>
            {spend.counterparties.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-faint">Nothing paid out yet.</p>
            ) : (
              <div className="space-y-3">
                {spend.counterparties.map((c) => (
                  <div key={c.name}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate" title={c.name}>
                        {c.name}
                        <span className="ml-2 text-xs text-ink-faint">
                          {c.count}×
                        </span>
                      </span>
                      <span className="tabular font-medium">{money(c.amount)}</span>
                    </div>
                    <div className="mt-1.5">
                      <ShareBar value={c.amount} max={maxCounterparty} color="#33473f" />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <BasisNote>
              Grouped on the description your bank supplies, so the same supplier can appear
              twice if they bill under different names.
            </BasisNote>
          </Card>
        </div>

        {/* ---- revenue and concentration ---- */}
        <Card className="mt-4 p-5">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">Where revenue comes from</h2>
            <span className="tabular font-bold text-money-in">
              {money(revenue.invoicedTotal)} invoiced
            </span>
          </div>

          {revenue.customers.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-faint">
              No invoices issued in this period.
            </p>
          ) : (
            <>
              {revenue.topShare >= 40 && (
                <p className="mb-4 rounded-lg bg-amber-50/70 px-3 py-2 text-sm text-amber-900">
                  <strong>{pct(revenue.topShare)}</strong> of invoiced revenue comes from one
                  customer, and {revenue.customersToHalf}{" "}
                  {revenue.customersToHalf === 1 ? "customer accounts" : "customers account"} for
                  half of it. Worth knowing before you lose one.
                </p>
              )}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th className="th">Customer</th>
                    <th className="th text-right">Invoices</th>
                    <th className="th text-right">Invoiced</th>
                    <th className="th text-right">Received</th>
                    <th className="th text-right">Outstanding</th>
                    <th className="th w-32">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {revenue.customers.map((c) => (
                    <tr key={c.id} className="hover:bg-paper/50">
                      <td className="td">
                        <Link href={`/customers/${c.id}`} className="text-brand hover:underline">
                          {c.name}
                        </Link>
                      </td>
                      <td className="td text-right tabular text-ink-soft">{c.invoiceCount}</td>
                      <td className="td text-right tabular font-medium">{money(c.invoiced)}</td>
                      <td className="td text-right tabular text-ink-soft">{money(c.received)}</td>
                      <td className="td text-right tabular">
                        {c.outstanding > 0.005 ? money(c.outstanding) : "—"}
                      </td>
                      <td className="td">
                        <div className="flex items-center gap-2">
                          <span className="w-10 shrink-0 text-right text-xs text-ink-faint">
                            {pct(c.sharePct)}
                          </span>
                          <ShareBar value={c.invoiced} max={maxRevenue} color="#0f7b5f" />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <BasisNote>
            Invoiced, by issue date — the accrual view, which is the right one for judging
            who you depend on. The margins above are cash basis, so these two totals will
            not agree, and should not.
          </BasisNote>
        </Card>

        {/* ---- month by month ---- */}
        {trend.length > 1 && (
          <Card className="mt-4 p-5">
            <h2 className="mb-4 font-semibold">Month by month</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="th">Month</th>
                  <th className="th text-right">Revenue</th>
                  <th className="th text-right">Cost of sales</th>
                  <th className="th text-right">Gross profit</th>
                  <th className="th text-right">Gross margin</th>
                  <th className="th text-right">Overheads</th>
                  <th className="th text-right">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {trend.map((t) => (
                  <tr key={t.month} className="hover:bg-paper/50">
                    <td className="td font-medium">{monthLabel(t.month)}</td>
                    <td className="td text-right tabular">{money(t.revenue)}</td>
                    <td className="td text-right tabular text-ink-soft">
                      {t.costOfSales ? money(t.costOfSales) : "—"}
                    </td>
                    <td className="td text-right tabular">{money(t.grossProfit)}</td>
                    <td className="td text-right tabular text-ink-soft">
                      {t.revenue ? pct(t.grossMarginPct) : "—"}
                    </td>
                    <td className="td text-right tabular text-ink-soft">{money(t.overheads)}</td>
                    <td
                      className={`td text-right tabular font-medium ${
                        t.net >= 0 ? "text-money-in" : "text-money-out"
                      }`}
                    >
                      {money(t.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {/* ---- the original P&L, kept ---- */}
        <Card className="mt-4 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Cashflow</h2>
            <span className="text-xs text-ink-faint">
              {fmtDate(period.from)} – {fmtDate(period.to)}
            </span>
          </div>
          <CashflowChart data={monthly} />
        </Card>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Income by category</h2>
              <span className="tabular font-bold text-money-in">{money(pnl.totalIncome)}</span>
            </div>
            <div className="divide-y divide-line">
              {pnl.income.map((r) => (
                <div key={r.name} className="flex justify-between py-2 text-sm">
                  <span>{r.name}</span>
                  <span className="tabular font-medium">{money(r.total)}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Expenses by category</h2>
              <span className="tabular font-bold text-money-out">{money(pnl.totalExpense)}</span>
            </div>
            <div className="divide-y divide-line">
              {pnl.expenses.map((r) => (
                <div key={r.name} className="flex justify-between py-2 text-sm">
                  <span>{r.name}</span>
                  <span className="tabular font-medium">{money(r.total)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    );
  });
}
