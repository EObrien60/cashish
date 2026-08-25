import { withTenant } from "@/lib/request-context";
import { listAllTransactions, listCategories, listVatRates } from "@/lib/lookups";
import { receiptCounts } from "@/lib/receipts";
import { PageHeader } from "@/components/ui";
import { TransactionsView } from "@/components/TransactionsView";

export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  return withTenant(async () => {
    const sp = await searchParams;
    const [transactions, categories, vatRates] = await Promise.all([
      listAllTransactions(),
      listCategories(),
      listVatRates(),
    ]);
    const counts = await receiptCounts(transactions.map((t) => t.id));

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
          receiptCounts={counts}
          initialFilter={sp.filter}
        />
      </div>
    );
  });
}
