import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@/lib/request-context";
import { accountBalances, getAccount } from "@/lib/accounts";
import { isLiability, ACCOUNT_KIND_LABELS } from "@/lib/account-kinds";
import { analyseAccount } from "@/lib/account-analysis";
import { moneyIn, fmtDate } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui";
import { BalanceChart, InOutChart } from "@/components/AccountCharts";

export const dynamic = "force-dynamic";

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  return withTenant(async () => {
    const { id } = await params;
    const account = await getAccount(id);
    if (!account) notFound();

    const [balances, analysis] = await Promise.all([
      accountBalances(true),
      analyseAccount(id, { openingBalance: account.openingBalance }),
    ]);
    const balance = balances.find((b) => b.id === id)!;
    const liability = isLiability(account.kind);
    const savings = account.kind === "savings";

    return (
      <div>
        <PageHeader
          title={account.name}
          subtitle={`${ACCOUNT_KIND_LABELS[account.kind] ?? account.kind} · ${account.currency}${
            account.inferred ? " · known only from transfers into it" : ""
          }`}
          actions={
            <div className="flex items-center gap-3">
              <Link href="/accounts" className="btn-ghost" prefetch={false}>
                All accounts
              </Link>
              <Link href={`/transactions?account=${id}`} className="btn-outline" prefetch={false}>
                {balance.transactions} transaction{balance.transactions === 1 ? "" : "s"}
              </Link>
            </div>
          }
        />

        <div className="grid gap-4 sm:grid-cols-4 mb-6">
          <Card>
            <div className="text-xs uppercase tracking-wide text-ink-faint">
              {liability ? (balance.balance < 0 ? "Owed" : "Balance") : "Balance"}
            </div>
            <div
              className={`text-2xl font-bold mt-1 ${
                balance.balance < 0 ? "text-money-out" : ""
              }`}
            >
              {liability && balance.balance < 0
                ? moneyIn(-balance.balance, account.currency)
                : moneyIn(balance.balance, account.currency)}
            </div>
            <div className="text-sm text-ink-faint mt-1">
              {balance.lastActivity ? `to ${fmtDate(balance.lastActivity)}` : "no activity"}
            </div>
          </Card>
          <Card>
            <div className="text-xs uppercase tracking-wide text-ink-faint">Moved in</div>
            <div className="text-2xl font-bold mt-1">
              {moneyIn(analysis.transferredIn, account.currency)}
            </div>
            <div className="text-sm text-ink-faint mt-1">
              {moneyIn(analysis.transferredOut, account.currency)} moved back out
            </div>
          </Card>
          <Card>
            <div className="text-xs uppercase tracking-wide text-ink-faint">
              {savings ? "Earned here" : "In, other than transfers"}
            </div>
            <div className="text-2xl font-bold mt-1 text-money-in">
              {moneyIn(analysis.earned, account.currency)}
            </div>
            <div className="text-sm text-ink-faint mt-1">
              {moneyIn(analysis.spent, account.currency)} out
            </div>
          </Card>
          <Card>
            {/* A deposit and a return look identical from one side of the
                story, so this is only claimed when nothing large arrived
                unexplained. Otherwise it says what it does not know. */}
            {analysis.returnIsKnowable ? (
              <>
                <div className="text-xs uppercase tracking-wide text-ink-faint">
                  {savings ? "Actual return" : "Change, excluding transfers"}
                </div>
                <div
                  className={`text-2xl font-bold mt-1 ${
                    analysis.growthFromAccount < 0 ? "text-money-out" : "text-money-in"
                  }`}
                >
                  {moneyIn(analysis.growthFromAccount, account.currency)}
                </div>
                <div className="text-sm text-ink-faint mt-1">
                  once the money you moved here is taken out
                </div>
              </>
            ) : (
              <>
                <div className="text-xs uppercase tracking-wide text-ink-faint">
                  {savings ? "Return" : "Change, excluding transfers"}
                </div>
                <div className="text-2xl font-bold mt-1 text-ink-faint">—</div>
                <div className="text-sm text-ink-faint mt-1">
                  {moneyIn(analysis.unmatchedIn, account.currency)} arrived with no matching
                  transfer, so a deposit cannot be told from a return here.
                </div>
              </>
            )}
          </Card>
        </div>

        <Card className="mb-6">
          <h2 className="font-semibold mb-3">Balance over time</h2>
          <BalanceChart data={analysis.months} currency={account.currency} />
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <h2 className="font-semibold mb-3">Money in and out</h2>
            <InOutChart data={analysis.months} currency={account.currency} />
          </Card>

          <Card>
            <h2 className="font-semibold mb-3">What this account is made of</h2>
            {analysis.topLines.length === 0 ? (
              <p className="text-sm text-ink-faint">Nothing on it yet.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {analysis.topLines.map((l) => (
                    <tr key={l.label} className="border-t border-line/60 first:border-0">
                      <td className="py-1.5">{l.label}</td>
                      <td className="py-1.5 text-right text-xs text-ink-faint">
                        ×{l.count}
                      </td>
                      <td
                        className={`py-1.5 text-right tabular-nums ${
                          l.total < 0 ? "text-money-out" : "text-money-in"
                        }`}
                      >
                        {moneyIn(l.total, account.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        {!analysis.returnIsKnowable && (
          <Card className="mt-6 border-brand/30">
            <p className="text-sm">
              <strong>{moneyIn(analysis.unmatchedIn, account.currency)}</strong> arrived on this
              account and <strong>{moneyIn(analysis.unmatchedOut, account.currency)}</strong> left,
              with no matching transfer from another account. Import the statement of the account
              that feeds this one and cashish will match the two halves — then it can separate what
              you deposited from what this account actually earned.{" "}
              <Link href="/transactions" className="underline">
                Import a statement
              </Link>
            </p>
          </Card>
        )}

        {analysis.months.length > 0 && (
          <p className="mt-6 text-xs text-ink-faint">
            Every line on the account is counted here, transfers and excluded rows included:
            this is what the bank says, not what the books count as income and spending.
            {balance.openingBalance !== 0 &&
              ` Starts from an opening balance of ${moneyIn(balance.openingBalance, account.currency)}.`}
          </p>
        )}
      </div>
    );
  });
}
