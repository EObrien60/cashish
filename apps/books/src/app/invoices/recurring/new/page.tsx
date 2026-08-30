import Link from "next/link";
import { withTenant } from "@/lib/request-context";
import { listProducts, listVatRates } from "@/lib/lookups";
import { listCustomers } from "@/lib/customers";
import { PageHeader, Card } from "@/components/ui";
import { RecurringEditor } from "@/components/RecurringEditor";

export const dynamic = "force-dynamic";

export default async function NewRecurringPage() {
  return withTenant(async () => {
    const [customers, products, vatRates] = await Promise.all([
      listCustomers(),
      listProducts(),
      listVatRates(),
    ]);

    if (customers.length === 0) {
      return (
        <div>
          <PageHeader title="New recurring invoice" />
          <Card className="p-8 text-center">
            <p className="text-ink-soft">
              Add a <Link href="/customers" className="font-medium text-brand hover:underline">customer</Link> first.
            </p>
          </Card>
        </div>
      );
    }

    return (
      <div>
        <PageHeader title="New recurring invoice" subtitle="A template that generates invoices on a schedule." />
        <RecurringEditor customers={customers} products={products} vatRates={vatRates} />
      </div>
    );
  });
}
