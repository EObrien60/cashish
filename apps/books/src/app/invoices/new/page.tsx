import Link from "next/link";
import { withTenant } from "@/lib/request-context";
import { listProducts, listVatRates } from "@/lib/lookups";
import { listCustomers } from "@/lib/customers";
import { nextInvoiceNumber } from "@/lib/invoices";
import { PageHeader, Card } from "@/components/ui";
import { InvoiceEditor } from "@/components/InvoiceEditor";
import { listContracts } from "@/lib/contracts";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage() {
  return withTenant(async () => {
    const [customers, products, vatRates, contractList] = await Promise.all([
      listCustomers(),
      listProducts(),
      listVatRates(),
      listContracts(),
    ]);
    const contracts = contractList.map((c) => ({
      id: c.id,
      name: c.name,
      customerId: c.customerId,
      customerName: c.customerName,
    }));
    const previewNumber = await nextInvoiceNumber();

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
          contracts={contracts}
          customers={customers}
          products={products}
          vatRates={vatRates}
          previewNumber={previewNumber}
        />
      </div>
    );
  });
}
