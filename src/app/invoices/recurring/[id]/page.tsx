import { boot } from "@/lib/boot";
import { db, schema } from "@/db/client";
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
  boot();
  const { id } = await params;
  const rec = getRecurring(id);
  if (!rec) notFound();

  const customers = db.select().from(schema.customers).orderBy(schema.customers.name).all();
  const products = db.select().from(schema.products).orderBy(schema.products.name).all();
  const vatRates = db.select().from(schema.vatRates).orderBy(schema.vatRates.sortOrder).all();

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
}
