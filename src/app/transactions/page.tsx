import { withTenant } from "@/lib/request-context";
import { listAllTransactions, listCategories, listVatRates } from "@/lib/lookups";
import { listPeople, fullName } from "@/lib/people";
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
    const [transactions, categories, vatRates, people] = await Promise.all([
      listAllTransactions(),
      listCategories(),
      listVatRates(),
      listPeople({ includeLeavers: true }),
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
          people={people.map((p) => ({ id: p.id, name: fullName(p) }))}
          initialFilter={sp.filter}
        />
      </div>
    );
  });
}
