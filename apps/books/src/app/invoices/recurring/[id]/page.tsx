import { withTenant } from "@/lib/request-context";
import { listProducts, listVatRates } from "@/lib/lookups";
import { listCustomers } from "@/lib/customers";
import { getRecurring } from "@/lib/recurring";
import { PageHeader } from "@/components/ui";
import { RecurringEditor } from "@/components/RecurringEditor";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function EditRecurringPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return withTenant(async () => {
    const { id } = await params;
    const rec = await getRecurring(id);
    if (!rec) notFound();

    const [customers, products, vatRates] = await Promise.all([
      listCustomers({ includeArchived: true }),
      listProducts({ includeArchived: true }),
      listVatRates(),
    ]);

    return (
      <div>
        <PageHeader title="Edit recurring invoice" />
        <RecurringEditor
          customers={customers}
          products={products}
          vatRates={vatRates}
          recurring={{
            id: rec.id,
            name: rec.name,
            customerId: rec.customerId,
            frequency: rec.frequency,
            interval: rec.interval,
            startDate: rec.startDate,
            endDate: rec.endDate,
            occurrencesLimit: rec.occurrencesLimit,
            dueDays: rec.dueDays,
            autoSend: rec.autoSend,
            notes: rec.notes,
            terms: rec.terms,
            lines: rec.lines,
          }}
        />
      </div>
    );
  });
}
