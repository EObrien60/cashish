import { withTenant } from "@/lib/request-context";
import { listProducts, listVatRates } from "@/lib/lookups";
import { listCustomers } from "@/lib/customers";
import { getInvoice } from "@/lib/invoices";
import { PageHeader } from "@/components/ui";
import { InvoiceEditor } from "@/components/InvoiceEditor";
import { listContracts } from "@/lib/contracts";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return withTenant(async () => {
    const { id } = await params;
    const invoice = await getInvoice(id);
    if (!invoice) notFound();

    const [customers, products, vatRates, contractList] = await Promise.all([
      listCustomers({ includeArchived: true }),
      listProducts({ includeArchived: true }),
      listVatRates(),
      // Closed ones too: an invoice already raised under a finished contract
      // must keep showing which contract that was.
      listContracts({ includeClosed: true }),
    ]);
    const contracts = contractList.map((c) => ({
      id: c.id,
      name: c.name,
      customerId: c.customerId,
      customerName: c.customerName,
    }));

    return (
      <div>
        <PageHeader title={`Edit ${invoice.number}`} />
        <InvoiceEditor
          contracts={contracts}
          customers={customers}
          products={products}
          vatRates={vatRates}
          invoice={{
            id: invoice.id,
            number: invoice.number,
            customerId: invoice.customerId,
            contractId: invoice.contractId,
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
  });
}
