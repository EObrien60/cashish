import Link from "next/link";
import { boot } from "@/lib/boot";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { nextInvoiceNumber } from "@/lib/invoices";
import { PageHeader, Card } from "@/components/ui";
import { InvoiceEditor } from "@/components/InvoiceEditor";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage() {
  boot();
  const customers = db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.archived, false))
    .orderBy(schema.customers.name)
    .all();
  const products = db.select().from(schema.products).orderBy(schema.products.name).all();
  const vatRates = db
    .select()
    .from(schema.vatRates)
    .orderBy(schema.vatRates.sortOrder)
    .all();
  const previewNumber = nextInvoiceNumber();

  if (customers.length === 0) {
    return (
      <div>
        <PageHeader title="New invoice" />
        <Card className="p-8 text-center">
          <p className="text-ink-soft">
            You need a customer first.{" "}
            <Link href="/customers" className="font-medium text-brand hover:underline">
              Add a customer
            </Link>{" "}
            to start invoicing.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="New invoice" subtitle={`Will be numbered ${previewNumber}`} />
      <InvoiceEditor
        customers={customers}
        products={products}
        vatRates={vatRates}
        previewNumber={previewNumber}
      />
    </div>
  );
}
