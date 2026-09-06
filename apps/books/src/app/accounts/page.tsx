import Link from "next/link";
import { withTenant } from "@/lib/request-context";
import { accountBalances, groupAccounts, unassignedCount } from "@/lib/accounts";
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
    const groups = groupAccounts(accounts);
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
          subtitle="What you hold, what you owe, and where it moved between."
        />

        {live.length === 0 && ledgerSize > 0 ? (
          <Card>
            <SetUpFromTransactions transactionCount={ledgerSize} />
          </Card>
        ) : live.length === 0 ? (
          <EmptyState
            title="No accounts yet"
            hint="Import a statement and the accounts in it appear here. A card or current-account export names its own account; for a savings one, say which account it is when you upload it."
            action={
              <Link href="/transactions" className="btn-primary">
                Import a statement
              </Link>
            }
          />
        ) : (
          <>
            {/* One block per currency. They are never added together: there
                is no exchange rate in the books, and inventing one would put a
                made-up number at the top of the page. */}
            {groups.map((g) => (
              <section key={g.currency} className="mb-8">
                {groups.length > 1 && (
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                    {g.currency}
                  </h2>
                )}

                <div className="grid gap-4 sm:grid-cols-3 mb-4">
                  <Card>
                    <div className="text-xs uppercase tracking-wide text-ink-faint">You hold</div>
                    <div className="text-2xl font-bold mt-1 text-money-in">
                      {moneyIn(g.held, g.currency)}
                    </div>
                    <div className="text-sm text-ink-faint mt-1">
                      {/* "X of it set aside" is only true while X is part of
                          the total; an overdrawn current account can make the
                          savings figure exceed everything held. */}
                      {g.saved > 0 && g.saved <= g.held
                        ? `${moneyIn(g.saved, g.currency)} of it set aside`
                        : `across ${g.assets.length} account${g.assets.length === 1 ? "" : "s"}`}
                    </div>
                  </Card>
                  <Card>
                    <div className="text-xs uppercase tracking-wide text-ink-faint">You owe</div>
                    <div
                      className={`text-2xl font-bold mt-1 ${
                        g.owed > 0 ? "text-money-out" : "text-ink-faint"
                      }`}
                    >
                      {moneyIn(g.owed, g.currency)}
                    </div>
                    <div className="text-sm text-ink-faint mt-1">
                      {g.liabilities.length > 0
                        ? `on ${g.liabilities.length} card${g.liabilities.length === 1 ? "" : "s"}`
                        : "no cards"}
                    </div>
                  </Card>
                  <Card>
                    <div className="text-xs uppercase tracking-wide text-ink-faint">Net</div>
                    <div className={`text-2xl font-bold mt-1 ${g.net < 0 ? "text-money-out" : ""}`}>
                      {moneyIn(g.net, g.currency)}
                    </div>
                    <div className="text-sm text-ink-faint mt-1">held less owed</div>
                  </Card>
                </div>

                <AccountsTable accounts={[...g.assets, ...g.liabilities]} all={live} />
              </section>
            ))}

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

            <Card>
              <RescanTransfers />
            </Card>
          </>
        )}
      </div>
    );
  });
}
