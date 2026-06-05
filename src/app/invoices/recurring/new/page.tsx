import Link from "next/link";
import { boot } from "@/lib/boot";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { PageHeader, Card } from "@/components/ui";
import { RecurringEditor } from "@/components/RecurringEditor";

export const dynamic = "force-dynamic";

export default async function NewRecurringPage() {
  boot();
  const customers = db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.archived, false))
    .orderBy(schema.customers.name)
    .all();
  const products = db.select().from(schema.products).orderBy(schema.products.name).all();
  const vatRates = db.select().from(schema.vatRates).orderBy(schema.vatRates.sortOrder).all();

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
}
