import { withTenant } from "@/lib/request-context";
import { listVendors, vendorTotals } from "@/lib/vendors";
import { listPayables } from "@/lib/bills";
import { listCategories } from "@/lib/lookups";
import { PageHeader } from "@/components/ui";
import { VendorsView } from "@/components/VendorsView";
import { saveVendor } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function VendorsPage() {
  return withTenant(async () => {
    const [vendors, totals, payables, categories] = await Promise.all([
      listVendors({ includeArchived: true }),
      vendorTotals(),
      listPayables(),
      listCategories(),
    ]);

    return (
      <div>
        <PageHeader
          title="Vendors"
          subtitle="Who you buy from, what you have spent with them, and what is still owed."
        />
        <VendorsView
          vendors={vendors}
          totals={Object.fromEntries(totals)}
          payables={payables}
          categories={categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind }))}
          saveVendor={saveVendor}
        />
      </div>
    );
  });
}
