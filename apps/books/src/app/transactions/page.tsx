import { withTenant } from "@/lib/request-context";
import { listCategories, listVatRates } from "@/lib/lookups";
import {
  listTransactions,
  summariseTransactions,
  transactionCounts,
  type TxFilter,
} from "@/lib/transactions";
import { listPeople, fullName } from "@/lib/people";
import { listVendors } from "@/lib/vendors";
import { receiptCounts } from "@/lib/receipts";
import { accountBalances } from "@/lib/accounts";
import { PageHeader } from "@/components/ui";
import { TransactionsView } from "@/components/TransactionsView";

export const dynamic = "force-dynamic";

// How many rows a page of the ledger holds. Filtering happens in Postgres, so
// this bounds what crosses the wire rather than what can be found: a personal
// statement going back three years is ten thousand lines, and sending them all
// cost 6.6 MB and a tab that stopped responding.
const PAGE = 200;

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    filter?: string;
    q?: string;
    dir?: string;
    tab?: string;
    limit?: string;
    account?: string;
  }>;
}) {
  return withTenant(async () => {
    const sp = await searchParams;

    const requested = Number(sp.limit);
    const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 5000) : PAGE;
    const search = (sp.q ?? "").trim();
    const direction = sp.dir === "in" || sp.dir === "out" ? sp.dir : undefined;
    const tab = sp.tab === "excluded" ? "excluded" : "active";
    const uncategorized = sp.filter === "uncategorized";
    const accountId = sp.account?.trim() || undefined;

    const filter: TxFilter = {
      ...(search ? { search } : {}),
      ...(direction ? { direction } : {}),
      ...(uncategorized ? { uncategorized: true } : {}),
      ...(accountId ? { accountId } : {}),
      excluded: tab === "excluded" ? "only" : "hide",
    };

    const [transactions, summary, counts, categories, vatRates, people, vendors] =
      await Promise.all([
        listTransactions({ ...filter, limit }),
        summariseTransactions(filter),
        transactionCounts(),
        listCategories(),
        listVatRates(),
        listPeople({ includeLeavers: true }),
        listVendors(),
      ]);

    const accounts = await accountBalances(true);

    const receipts = await receiptCounts(transactions.map((t) => t.id));

    return (
      <div>
        <PageHeader
          title="Transactions"
          subtitle="Your bank ledger. Categorise to power reports and VAT."
        />
        <TransactionsView
          transactions={transactions}
          categories={categories}
          vatRates={vatRates}
          receiptCounts={receipts}
          people={people.map((p) => ({ id: p.id, name: fullName(p) }))}
          vendors={vendors.map((v) => ({ id: v.id, name: v.name }))}
          accounts={accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
          filters={{ search, direction: direction ?? "all", uncategorized, tab, accountId: accountId ?? "" }}
          summary={summary}
          counts={counts}
          pageSize={PAGE}
        />
      </div>
    );
  });
}
