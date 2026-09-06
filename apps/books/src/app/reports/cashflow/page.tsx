import Link from "next/link";
import { redirect } from "next/navigation";
import { withTenant } from "@/lib/request-context";
import { bookKind } from "@/lib/lookups";
import { buildCashflowForecast, defaultWindow, type ForecastRow } from "@/lib/cashflow";
import { money, todayISO, fmtDate } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

// The forecast on screen and the forecast in the workbook are the same object;
// this page renders it as HTML so the numbers can be checked before anyone
// downloads them.

function Amount({ value }: { value: number }) {
  if (value === 0) return <td className="px-3 py-1.5 text-right text-ink-faint">—</td>;
  const negative = value < 0;
  return (
    <td
      className={`px-3 py-1.5 text-right tabular-nums whitespace-nowrap ${
        negative ? "text-money-out" : "text-ink"
      }`}
    >
      {negative ? `(${money(Math.abs(value))})` : money(value)}
    </td>
  );
}

function LineRows({ rows, empty }: { rows: ForecastRow[]; empty: string }) {
  if (rows.length === 0) {
    return (
      <tr>
        <td className="px-3 py-2 text-sm text-ink-faint italic" colSpan={99}>
          {empty}
        </td>
      </tr>
    );
  }
  return (
    <>
      {rows.map((row) => (
        <tr key={row.key} className="border-t border-line/60">
          <td className="px-3 py-1.5 whitespace-nowrap sticky left-0 bg-card">{row.label}</td>
          {row.amounts.map((amount, i) => (
            <Amount key={i} value={amount} />
          ))}
        </tr>
      ))}
    </>
  );
}

export default async function CashflowPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; lookback?: string }>;
}) {
  return withTenant(async () => {
    // Hidden in the nav for a personal book, so reaching this is a typed URL or
    // an old bookmark. Redirect rather than 404: the forecast projects open
    // invoices and recurring invoice templates forward, and a household has
    // neither — the page would render an empty sheet and look broken.
    if ((await bookKind()) === "personal") redirect("/reports");

    const sp = await searchParams;
    const fallback = defaultWindow(todayISO());
    const from = sp.from || fallback.from;
    const to = sp.to || fallback.to;
    const lookback = Number(sp.lookback) > 0 ? Number(sp.lookback) : 6;

    const invalid = to < from;
    const forecast = invalid
      ? null
      : await buildCashflowForecast({ from, to, lookbackMonths: lookback });

    const download = `/api/reports/cashflow?from=${from}&to=${to}&lookback=${lookback}`;

    return (
      <div>
        <PageHeader
          title="Cash flow forecast"
          subtitle="What the books already commit you to, month by month. Export it and add the rest."
        />

        <Card className="mb-6">
          {/* A GET form: the window ends up in the URL, so a forecast can be
              bookmarked and sent to someone else. */}
          <form method="get" className="flex flex-wrap items-end gap-4">
            <label className="text-sm">
              <span className="block text-ink-soft mb-1">From</span>
              <input type="date" name="from" defaultValue={from} className="input" />
            </label>
            <label className="text-sm">
              <span className="block text-ink-soft mb-1">To</span>
              <input type="date" name="to" defaultValue={to} className="input" />
            </label>
            <label className="text-sm">
              <span className="block text-ink-soft mb-1">Look back</span>
              <select name="lookback" defaultValue={String(lookback)} className="input">
                <option value="3">3 months</option>
                <option value="6">6 months</option>
                <option value="12">12 months</option>
              </select>
            </label>
            <button type="submit" className="btn-outline">
              Update
            </button>
            <Link href={download} className="btn-primary" prefetch={false}>
              Download .xlsx
            </Link>
          </form>
        </Card>

        {invalid || !forecast ? (
          <Card>
            <p className="text-sm text-money-out">
              The end of the window is before its start.
            </p>
          </Card>
        ) : (
          <>
            <Card className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-black/[0.04] text-ink-soft">
                    <th className="px-3 py-2 text-left font-semibold sticky left-0 bg-[#f1f1f1]">
                      &nbsp;
                    </th>
                    {forecast.months.map((m) => (
                      <th key={m.key} className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                        {m.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="font-semibold">
                    <td className="px-3 py-1.5 sticky left-0 bg-card">Balance</td>
                    {forecast.balances.map((b, i) => (
                      <Amount key={i} value={b} />
                    ))}
                  </tr>

                  <tr className="bg-black/[0.02] font-semibold">
                    <td className="px-3 py-1.5 sticky left-0 bg-[#fafafa]" colSpan={99}>
                      Income
                    </td>
                  </tr>
                  <LineRows
                    rows={forecast.income}
                    empty="Nothing outstanding and no recurring invoices in this window."
                  />
                  <tr className="font-semibold border-t border-line">
                    <td className="px-3 py-1.5 sticky left-0 bg-card">Total Income</td>
                    {forecast.totalIncome.map((v, i) => (
                      <Amount key={i} value={v} />
                    ))}
                  </tr>

                  <tr className="bg-black/[0.02] font-semibold">
                    <td className="px-3 py-1.5 sticky left-0 bg-[#fafafa]" colSpan={99}>
                      Expenses
                    </td>
                  </tr>
                  <LineRows
                    rows={forecast.expenses}
                    empty={`Nothing repeated in at least half of the last ${forecast.lookbackMonths} months.`}
                  />
                  <tr className="font-semibold border-t border-line">
                    <td className="px-3 py-1.5 sticky left-0 bg-card">Total Expenses</td>
                    {forecast.totalExpenses.map((v, i) => (
                      <Amount key={i} value={v} />
                    ))}
                  </tr>

                  <tr className="font-semibold">
                    <td className="px-3 py-1.5 sticky left-0 bg-card">Net Income</td>
                    {forecast.netIncome.map((v, i) => (
                      <Amount key={i} value={v} />
                    ))}
                  </tr>
                  <tr className="font-semibold border-t-2 border-line">
                    <td className="px-3 py-1.5 sticky left-0 bg-card">Closing Balance</td>
                    {forecast.closingBalance.map((v, i) => (
                      <Amount key={i} value={v} />
                    ))}
                  </tr>
                </tbody>
              </table>
            </Card>

            <Card className="mt-6">
              <h2 className="font-semibold mb-2">What this is built from</h2>
              <ul className="text-sm text-ink-soft space-y-1 list-disc pl-5">
                <li>
                  Opening balance:{" "}
                  {forecast.openingBasis === "bank-balance"
                    ? `the bank's own running balance at ${fmtDate(forecast.openingAsOf)}.`
                    : `the sum of every transaction to ${fmtDate(forecast.openingAsOf)} — no statement balance was imported, so this is only right if the ledger goes back to the account's opening.`}
                </li>
                <li>
                  Income is <strong>committed money only</strong>: what is still outstanding on
                  open invoices, placed in the month it falls due, plus anything active recurring
                  templates will raise. Work you have agreed but not invoiced is not in the books,
                  so it is not here — add it to the sheet after downloading.
                </li>
                <li>
                  Expenses are outgoings that appeared in at least half of the last{" "}
                  {forecast.lookbackMonths} whole months, carried forward at the median of those
                  months. Costs that repeat less often than monthly — an annual insurance premium,
                  a bi-monthly VAT payment — are not projected.
                </li>
                <li>
                  In the workbook the totals, net and closing balance are formulas, so lines you
                  add are picked up.
                </li>
              </ul>
            </Card>
          </>
        )}
      </div>
    );
  });
}
