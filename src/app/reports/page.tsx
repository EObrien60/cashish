import { withTenant } from "@/lib/request-context";
import { profitAndLoss, monthlyCashflow } from "@/lib/reports";
import { resolvePeriod } from "@/lib/period";
import { money, fmtDate } from "@/lib/format";
import { Card, PageHeader, StatCard } from "@/components/ui";
import { PeriodTabs } from "@/components/PeriodTabs";
import { CashflowChart } from "@/components/BarChart";

export const dynamic = "force-dynamic";

function Section({
  title,
  rows,
  total,
  tone,
}: {
  title: string;
  rows: { name: string; total: number; count: number }[];
  total: number;
  tone: "in" | "out";
}) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        <span
          className={`tabular font-bold ${
            tone === "in" ? "text-money-in" : "text-money-out"
          }`}
        >
          {money(total)}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink-faint">Nothing here yet.</p>
      ) : (
        <div className="divide-y divide-line">
          {rows.map((r) => (
            <div key={r.name} className="flex items-center justify-between py-2 text-sm">
              <span>
                {r.name}
                {r.count > 0 && (
                  <span className="ml-2 text-xs text-ink-faint">
                    {r.count} tx
                  </span>
                )}
              </span>
              <span className="tabular font-medium">{money(r.total)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  return withTenant(async () => {
    const sp = await searchParams;
    const period = resolvePeriod(sp.period);
    const pnl = await profitAndLoss(period.from, period.to);
    const monthly = await monthlyCashflow(period.from, period.to);

    return (
      <div>
        <PageHeader
          title="Reports"
          subtitle="Profit & loss and cashflow, straight from your ledger."
        />
        <div className="mb-6">
          <PeriodTabs active={period.key} basePath="/reports" />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Total income" value={money(pnl.totalIncome)} tone="in" />
          <StatCard label="Total expenses" value={money(pnl.totalExpense)} tone="out" />
          <StatCard
            label="Net profit"
            value={money(pnl.net)}
            tone={pnl.net >= 0 ? "in" : "out"}
          />
        </div>

        <Card className="mt-4 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Monthly cashflow</h2>
            <span className="text-xs text-ink-faint">
              {fmtDate(period.from)} – {fmtDate(period.to)}
            </span>
          </div>
          <CashflowChart data={monthly} />
        </Card>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Section
            title="Income"
            rows={pnl.income.map((i) => ({ name: i.name, total: i.total, count: i.count }))}
            total={pnl.totalIncome}
            tone="in"
          />
          <Section
            title="Expenses"
            rows={pnl.expenses.map((e) => ({ name: e.name, total: e.total, count: e.count }))}
            total={pnl.totalExpense}
            tone="out"
          />
        </div>

        {(pnl.uncategorizedIncome > 0 || pnl.uncategorizedExpense > 0) && (
          <p className="mt-4 text-sm text-ink-faint">
            Tip: you have uncategorised transactions affecting these totals.
            Categorise them on the{" "}
            <a href="/transactions?filter=uncategorized" className="text-brand hover:underline">
              Transactions
            </a>{" "}
            page for accurate reporting.
          </p>
        )}
      </div>
    );
  });
}
