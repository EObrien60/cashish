import Link from "next/link";
import { withTenant } from "@/lib/request-context";
import { budgetForMonth, currentMonth, shiftMonth, type BudgetLine } from "@/lib/budgets";
import { money, todayISO } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui";
import { BudgetAmount, CopyLastMonth, SuggestFromHistory } from "@/components/BudgetControls";

export const dynamic = "force-dynamic";

// Budget versus actual, one month at a time. The bar is the point: a number
// tells you what you spent, a bar tells you whether to stop.

function Bar({ line }: { line: BudgetLine }) {
  if (line.budget === 0) {
    return <span className="text-xs text-ink-faint">no budget</span>;
  }
  const pct = Math.min(100, line.usedPct ?? 0);
  const over = (line.usedPct ?? 0) > 100;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-32 rounded-full bg-black/[0.07] overflow-hidden">
        <div
          className={`h-full rounded-full ${over ? "bg-money-out" : "bg-brand"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs tabular-nums ${over ? "text-money-out" : "text-ink-faint"}`}>
        {Math.round(line.usedPct ?? 0)}%
      </span>
    </div>
  );
}

function Rows({ lines, month, kind }: { lines: BudgetLine[]; month: string; kind: string }) {
  if (lines.length === 0) {
    return (
      <tr>
        <td colSpan={5} className="px-4 py-3 text-sm text-ink-faint italic">
          Nothing budgeted or spent here this month.
        </td>
      </tr>
    );
  }
  return (
    <>
      {lines.map((line) => (
        <tr key={line.categoryId} className="border-t border-line/60">
          <td className="px-4 py-2">
            <span className="inline-flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: line.color }}
              />
              {line.name}
            </span>
          </td>
          <td className="px-4 py-2 text-right">
            <BudgetAmount categoryId={line.categoryId} month={month} amount={line.budget} />
          </td>
          <td className="px-4 py-2 text-right tabular-nums">{money(line.actual)}</td>
          <td
            className={`px-4 py-2 text-right tabular-nums ${
              line.budget === 0 ? "text-ink-faint" : line.remaining < 0 ? "text-money-out" : "text-ink-soft"
            }`}
          >
            {/* Nothing budgeted is not the same as being over budget: without an
                envelope there is nothing to be over, and saying "€1,450 over"
                for a category nobody has planned yet is just noise. */}
            {line.budget === 0
              ? "—"
              : line.remaining < 0
                ? `${money(Math.abs(line.remaining))} ${kind === "income" ? "short" : "over"}`
                : `${money(line.remaining)} left`}
          </td>
          <td className="px-4 py-2">
            <Bar line={line} />
          </td>
        </tr>
      ))}
    </>
  );
}

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  return withTenant(async () => {
    const sp = await searchParams;
    const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : currentMonth(todayISO());
    const data = await budgetForMonth(month);
    const previous = shiftMonth(month, -1);

    const label = new Date(month + "-01T00:00:00Z").toLocaleDateString("en-IE", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });

    const left = data.totals.budgetedExpense - data.totals.actualExpense;

    return (
      <div>
        <PageHeader
          title="Budget"
          subtitle="What you meant to spend, against what the bank says you did."
          actions={
            <div className="flex items-center gap-2">
              <Link href={`/budget?month=${previous}`} className="btn-ghost" prefetch={false}>
                ←
              </Link>
              <span className="font-semibold w-40 text-center">{label}</span>
              <Link
                href={`/budget?month=${shiftMonth(month, 1)}`}
                className="btn-ghost"
                prefetch={false}
              >
                →
              </Link>
            </div>
          }
        />

        <div className="grid gap-4 sm:grid-cols-3 mb-6">
          <Card>
            <div className="text-xs uppercase tracking-wide text-ink-faint">Budgeted to spend</div>
            <div className="text-2xl font-bold mt-1">{money(data.totals.budgetedExpense)}</div>
            <div className="text-sm text-ink-faint mt-1">
              {money(data.totals.actualExpense)} spent
            </div>
          </Card>
          <Card>
            <div className="text-xs uppercase tracking-wide text-ink-faint">
              {left >= 0 ? "Left to spend" : "Over budget"}
            </div>
            <div className={`text-2xl font-bold mt-1 ${left < 0 ? "text-money-out" : "text-money-in"}`}>
              {money(Math.abs(left))}
            </div>
            <div className="text-sm text-ink-faint mt-1">across every envelope</div>
          </Card>
          <Card>
            <div className="text-xs uppercase tracking-wide text-ink-faint">Actual net</div>
            <div
              className={`text-2xl font-bold mt-1 ${
                data.totals.actualNet < 0 ? "text-money-out" : "text-money-in"
              }`}
            >
              {money(data.totals.actualNet)}
            </div>
            <div className="text-sm text-ink-faint mt-1">
              planned {money(data.totals.plannedNet)}
            </div>
          </Card>
        </div>

        {data.totals.unbudgetedSpend > 0 && (
          <Card className="mb-6 border-money-out/30">
            <p className="text-sm">
              <strong>{money(data.totals.unbudgetedSpend)}</strong> went out uncategorised this
              month, so it is in no envelope.{" "}
              <Link href="/transactions?uncategorized=1" className="underline">
                Categorise it
              </Link>{" "}
              or add a rule and these numbers get honest.
            </p>
          </Card>
        )}

        <Card className="p-0 overflow-x-auto">
          <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-line">
            <h2 className="font-semibold">Spending</h2>
            <div className="flex items-center gap-2">
              <CopyLastMonth month={month} from={previous} />
              <SuggestFromHistory month={month} />
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-ink-soft bg-black/[0.02]">
                <th className="px-4 py-2 text-left font-semibold">Category</th>
                <th className="px-4 py-2 text-right font-semibold w-32">Budget</th>
                <th className="px-4 py-2 text-right font-semibold w-28">Actual</th>
                <th className="px-4 py-2 text-right font-semibold w-36">Remaining</th>
                <th className="px-4 py-2 text-left font-semibold w-48">Used</th>
              </tr>
            </thead>
            <tbody>
              <Rows lines={data.expenses} month={month} kind="expense" />
            </tbody>
          </table>
        </Card>

        <Card className="p-0 overflow-x-auto mt-6">
          <div className="px-4 py-3 border-b border-line">
            <h2 className="font-semibold">Income</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-ink-soft bg-black/[0.02]">
                <th className="px-4 py-2 text-left font-semibold">Category</th>
                <th className="px-4 py-2 text-right font-semibold w-32">Expected</th>
                <th className="px-4 py-2 text-right font-semibold w-28">Received</th>
                <th className="px-4 py-2 text-right font-semibold w-36">Difference</th>
                <th className="px-4 py-2 text-left font-semibold w-48">Received</th>
              </tr>
            </thead>
            <tbody>
              <Rows lines={data.income} month={month} kind="income" />
            </tbody>
          </table>
        </Card>
      </div>
    );
  });
}
