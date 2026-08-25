import Link from "next/link";
import { withTenant } from "@/lib/request-context";
import { dashboardStats } from "@/lib/reports";
import { resolvePeriod } from "@/lib/period";
import { money } from "@/lib/format";
import { Card, PageHeader, StatCard, Dot } from "@/components/ui";
import { PeriodTabs } from "@/components/PeriodTabs";
import { CashflowChart } from "@/components/BarChart";
import { IconUpload, IconPlus, IconChevron } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  return withTenant(async () => {
    const sp = await searchParams;
    const period = resolvePeriod(sp.period);
    const s = await dashboardStats(period.from, period.to);

    return (
      <div>
        <PageHeader
          title="Dashboard"
          subtitle="Your money, at a glance."
          actions={
            <>
              <Link href="/transactions" className="btn-outline">
                <IconUpload className="h-4 w-4" /> Import statement
              </Link>
              <Link href="/invoices/new" className="btn-primary">
                <IconPlus className="h-4 w-4" /> New invoice
              </Link>
            </>
          }
        />

        <div className="mb-6">
          <PeriodTabs active={period.key} basePath="/" />
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Money in"
            value={money(s.cashIn)}
            tone="in"
            sub={`${s.txCount} transactions`}
          />
          <StatCard label="Money out" value={money(s.cashOut)} tone="out" />
          <StatCard
            label="Net"
            value={money(s.net)}
            tone={s.net >= 0 ? "in" : "out"}
          />
          <StatCard
            label="Balance"
            value={s.latestBalance === null ? "—" : money(s.latestBalance)}
            sub="latest from statement"
          />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Cashflow</h2>
              <span className="text-xs text-ink-faint">{period.label}</span>
            </div>
            <CashflowChart data={s.monthly} />
          </Card>

          <div className="space-y-4">
            <Card className="p-5">
              <h2 className="mb-1 font-semibold">Receivables</h2>
              <div className="text-2xl font-bold tabular text-ink">
                {money(s.outstandingAmount)}
              </div>
              <div className="text-xs text-ink-faint">
                {s.outstandingInvoices} open invoice
                {s.outstandingInvoices === 1 ? "" : "s"}
              </div>
              {s.overdueAmount > 0 && (
                <div className="mt-3 rounded-lg bg-money-out/10 px-3 py-2 text-sm text-money-out">
                  {money(s.overdueAmount)} overdue
                </div>
              )}
              <Link
                href="/invoices"
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
              >
                View invoices <IconChevron className="h-4 w-4" />
              </Link>
            </Card>

            {s.uncategorized > 0 && (
              <Card className="p-5">
                <h2 className="mb-1 font-semibold">Needs attention</h2>
                <div className="text-sm text-ink-soft">
                  {s.uncategorized} transaction
                  {s.uncategorized === 1 ? "" : "s"} not categorised — categorise
                  them so your reports and VAT return are accurate.
                </div>
                <Link
                  href="/transactions?filter=uncategorized"
                  className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
                >
                  Categorise now <IconChevron className="h-4 w-4" />
                </Link>
              </Card>
            )}
          </div>
        </div>

        <Card className="mt-4 p-5">
          <h2 className="mb-4 font-semibold">Top expenses</h2>
          {s.topExpenses.length === 0 ? (
            <div className="py-6 text-center text-sm text-ink-faint">
              No categorised expenses yet.
            </div>
          ) : (
            <div className="space-y-3">
              {s.topExpenses.map((e) => {
                const max = s.topExpenses[0].total || 1;
                return (
                  <div key={e.categoryId ?? "none"} className="flex items-center gap-3">
                    <div className="w-44 truncate text-sm">{e.name}</div>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-black/[0.04]">
                      <div
                        className="h-full rounded-full bg-brand/70"
                        style={{ width: `${(e.total / max) * 100}%` }}
                      />
                    </div>
                    <div className="w-28 text-right text-sm tabular font-medium">
                      {money(e.total)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    );
  });
}
