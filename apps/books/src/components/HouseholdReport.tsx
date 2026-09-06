import Link from "next/link";
import { money } from "@/lib/format";
import { Card } from "./ui";
import { Delta, ShareBar, BasisNote } from "./ReportBits";
import { CashflowChart } from "./BarChart";
import type { SpendReport } from "@/lib/analysis";
import type { ProfitAndLoss, MonthPoint } from "@/lib/reports";

/**
 * Reports for a personal book.
 *
 * The business report is built on revenue, cost of sales and gross margin, and
 * none of those mean anything for a household: there is no revenue, nothing is
 * sold, and a "margin" on a salary is not a concept. Showing it with the words
 * swapped would be worse than not showing it — it invites someone to read a
 * grocery bill as a cost of sales.
 *
 * So this asks the questions a person actually has: what came in, what went
 * out, what is left, and what proportion of what I earned did I keep.
 */

const pct = (n: number) => `${n.toFixed(1)}%`;

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m: string) => {
  const [y, mm] = m.split("-");
  return `${MONTHS[Number(mm)]} ${y.slice(2)}`;
};

function Metric({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "in" | "out";
  hint?: string;
}) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-ink-faint">{label}</div>
      <div
        className={`mt-1 text-2xl font-bold ${
          tone === "in" ? "text-money-in" : tone === "out" ? "text-money-out" : ""
        }`}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-sm text-ink-faint">{hint}</div>}
    </Card>
  );
}

export function HouseholdReport({
  pnl,
  monthly,
  spend,
  period,
}: {
  pnl: ProfitAndLoss;
  monthly: MonthPoint[];
  spend: SpendReport;
  period: { from: string; to: string };
}) {
  const income = pnl.totalIncome;
  const outgoings = pnl.totalExpense;
  const kept = income - outgoings;
  // Only meaningful when something came in. A savings rate against zero income
  // is a division by zero dressed up as a percentage.
  const keptPct = income > 0 ? (kept / income) * 100 : null;

  const maxSpend = spend.lines[0]?.amount ?? 0;
  const maxPaid = spend.counterparties[0]?.amount ?? 0;
  const best = [...monthly].sort((a, b) => b.net - a.net)[0];
  const worst = [...monthly].sort((a, b) => a.net - b.net)[0];

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Came in" value={money(income)} tone="in" />
        <Metric label="Went out" value={money(outgoings)} tone="out" />
        <Metric
          label="Kept"
          value={money(kept)}
          tone={kept >= 0 ? "in" : "out"}
          hint={kept < 0 ? "you spent more than came in" : undefined}
        />
        <Metric
          label="Of what you earned"
          value={keptPct === null ? "—" : pct(keptPct)}
          hint={keptPct === null ? "nothing came in this period" : "kept rather than spent"}
        />
      </div>

      {monthly.length > 1 && best && worst && best.month !== worst.month && (
        <Card className="mt-4 p-5">
          <h2 className="font-semibold">Best and worst month</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <div className="text-sm text-ink-soft">{monthLabel(best.month)}</div>
              <div className="tabular text-xl font-semibold text-money-in">
                {money(best.net)} kept
              </div>
              <div className="text-xs text-ink-faint">
                {money(best.income)} in · {money(best.expense)} out
              </div>
            </div>
            <div>
              <div className="text-sm text-ink-soft">{monthLabel(worst.month)}</div>
              <div
                className={`tabular text-xl font-semibold ${
                  worst.net < 0 ? "text-money-out" : ""
                }`}
              >
                {money(worst.net)} kept
              </div>
              <div className="text-xs text-ink-faint">
                {money(worst.income)} in · {money(worst.expense)} out
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card className="mt-4 p-5">
        <h2 className="mb-4 font-semibold">Month by month</h2>
        <CashflowChart data={monthly} />
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="font-semibold">Where it went</h2>
            <span className="flex items-baseline gap-2">
              <span className="tabular font-bold text-money-out">{money(spend.total)}</span>
              <Delta value={spend.changePct} goodWhenUp={false} />
            </span>
          </div>
          {spend.lines.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-faint">
              No spending in this period.
            </p>
          ) : (
            <div className="space-y-3">
              {spend.lines.map((l) => (
                <div key={l.categoryId ?? "uncat"}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate">{l.name}</span>
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
            Share of total spending. The arrow compares with the same length of time
            immediately before this period. Money moved between your own accounts is not
            counted here.
          </BasisNote>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="font-semibold">Who got it</h2>
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
                      <span className="ml-2 text-xs text-ink-faint">{c.count}×</span>
                    </span>
                    <span className="tabular font-medium">{money(c.amount)}</span>
                  </div>
                  <div className="mt-1.5">
                    <ShareBar value={c.amount} max={maxPaid} color="#33473f" />
                  </div>
                </div>
              ))}
            </div>
          )}
          <BasisNote>
            Grouped on the description your bank supplies, so one shop can appear twice if
            it bills under different names.
          </BasisNote>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">What came in</h2>
            <span className="tabular font-bold text-money-in">{money(pnl.totalIncome)}</span>
          </div>
          {pnl.income.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-faint">
              Nothing categorised as income yet.
            </p>
          ) : (
            <div className="divide-y divide-line">
              {pnl.income.map((r) => (
                <div key={r.name} className="flex justify-between py-2 text-sm">
                  <span>{r.name}</span>
                  <span className="tabular font-medium">{money(r.total)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold">Where to look next</h2>
          <ul className="mt-3 space-y-2 text-sm text-ink-soft">
            <li>
              <Link href="/budget" className="text-brand hover:underline">
                Budget
              </Link>{" "}
              — set what you mean to spend per category and check it against these figures.
            </li>
            <li>
              <Link href="/insights" className="text-brand hover:underline">
                Where it went
              </Link>{" "}
              — the costs that recur every month, and what they leave.
            </li>
            <li>
              <Link href="/accounts" className="text-brand hover:underline">
                Accounts
              </Link>{" "}
              — balances across current, credit card and savings.
            </li>
          </ul>
          <BasisNote>
            Everything here is cash basis: what actually moved through your accounts
            between {period.from} and {period.to}.
          </BasisNote>
        </Card>
      </div>
    </>
  );
}
