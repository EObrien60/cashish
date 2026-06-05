import { boot } from "@/lib/boot";
import { db, schema } from "@/db/client";
import { eq, or } from "drizzle-orm";
import { getInvoice } from "@/lib/invoices";
import { PageHeader } from "@/components/ui";
import { InvoiceEditor } from "@/components/InvoiceEditor";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  boot();
  const { id } = await params;
  const invoice = getInvoice(id);
  if (!invoice) notFound();

  const customers = db.select().from(schema.customers).orderBy(schema.customers.name).all();
  const products = db.select().from(schema.products).orderBy(schema.products.name).all();
  const vatRates = db
    .select()
    .from(schema.vatRates)
    .orderBy(schema.vatRates.sortOrder)
    .all();

  return (
    <div>
      <PageHeader title={`Edit ${invoice.number}`} />
      <InvoiceEditor
        customers={customers}
        products={products}
        vatRates={vatRates}
        invoice={{
          id: invoice.id,
          number: invoice.number,
          customerId: invoice.customerId,
          status: invoice.status,
          issueDate: invoice.issueDate,
          dueDate: invoice.dueDate,
          notes: invoice.notes,
          terms: invoice.terms,
          lines: invoice.lines,
        }}
      />
    </div>
  );
}
