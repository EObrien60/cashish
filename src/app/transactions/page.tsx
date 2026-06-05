import { boot } from "@/lib/boot";
import { db, schema } from "@/db/client";
import { desc } from "drizzle-orm";
import { receiptCounts } from "@/lib/receipts";
import { PageHeader } from "@/components/ui";
import { TransactionsView } from "@/components/TransactionsView";

export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  boot();
  const sp = await searchParams;
  const transactions = db
    .select()
    .from(schema.transactions)
    .orderBy(desc(schema.transactions.bookedDate), desc(schema.transactions.createdAt))
    .all();
  const categories = db
    .select()
    .from(schema.categories)
    .orderBy(schema.categories.kind, schema.categories.name)
    .all();
  const vatRates = db
    .select()
    .from(schema.vatRates)
    .orderBy(schema.vatRates.sortOrder)
    .all();
  const counts = receiptCounts(transactions.map((t) => t.id));

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
}
