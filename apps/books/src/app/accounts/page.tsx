import Link from "next/link";
import { withTenant } from "@/lib/request-context";
import { accountBalances, unassignedCount } from "@/lib/accounts";
import { transactionCounts } from "@/lib/transactions";
import { moneyIn } from "@/lib/format";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import {
  AccountsTable,
  AssignUnassigned,
  RescanTransfers,
  SetUpFromTransactions,
} from "@/components/AccountsView";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  return withTenant(async () => {
    const [accounts, unassigned, counts] = await Promise.all([
      accountBalances(true),
      unassignedCount(),
      transactionCounts(),
    ]);
    const ledgerSize = counts.included + counts.excluded;

    const live = accounts.filter((a) => !a.archived);
    const inferred = live.filter((a) => a.inferred);
    // Currencies do not add up, so a single total across a EUR and a GBP
    // account would be a made-up number. One line per currency instead.
    const byCurrency = new Map<string, number>();
    for (const a of live) {
      byCurrency.set(a.currency, (byCurrency.get(a.currency) ?? 0) + a.balance);
    }

    return (
      <div>
        <PageHeader
          title="Accounts"
          subtitle="Current accounts, cards, savings and currencies — found in your statements, not set up by hand."
        />

        {live.length === 0 && ledgerSize > 0 ? (
          <Card>
            <SetUpFromTransactions transactionCount={ledgerSize} />
          </Card>
        ) : live.length === 0 ? (
          <EmptyState
            title="No accounts yet"
            hint="Import a statement and the accounts in it appear here. Revolut names them in the file — Product on a personal export, Account on a business one."
            action={
              <Link href="/transactions" className="btn-primary">
                Import a statement
              </Link>
            }
          />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3 mb-6">
              {[...byCurrency.entries()].map(([currency, total]) => (
                <Card key={currency}>
                  <div className="text-xs uppercase tracking-wide text-ink-faint">
                    Total held ({currency})
                  </div>
                  <div className={`text-2xl font-bold mt-1 ${total < 0 ? "text-money-out" : ""}`}>
                    {moneyIn(total, currency)}
                  </div>
                  <div className="text-sm text-ink-faint mt-1">
                    across {live.filter((a) => a.currency === currency).length} account
                    {live.filter((a) => a.currency === currency).length === 1 ? "" : "s"}
                  </div>
                </Card>
              ))}
            </div>

            {inferred.length > 0 && (
              <Card className="mb-6 border-brand/30">
                <p className="text-sm">
                  {inferred.length === 1 ? "One account was" : `${inferred.length} accounts were`}{" "}
                  created from the other side of a transfer:{" "}
                  <strong>{inferred.map((a) => a.name).join(", ")}</strong>. The money that moved
                  there is accounted for, but the balance only reflects those transfers until you
                  import that account&rsquo;s own statement.
                </p>
              </Card>
            )}

            {unassigned > 0 && (
              <Card className="mb-6">
                <AssignUnassigned
                  count={unassigned}
                  accounts={live.map((a) => ({ id: a.id, name: a.name }))}
                />
              </Card>
            )}

            <AccountsTable accounts={accounts} />

            <Card className="mt-6">
              <RescanTransfers />
            </Card>
          </>
        )}
      </div>
    );
  });
}
