import { withTenant } from "@/lib/request-context";
import { listCategories, listProducts, listVatRates } from "@/lib/lookups";
import { PageHeader } from "@/components/ui";
import { ProductsView } from "@/components/ProductsView";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  return withTenant(async () => {
    const [products, vatRates, categories] = await Promise.all([
      listProducts({ includeArchived: true }),
      listVatRates(),
      listCategories(),
    ]);
    return (
      <div>
        <PageHeader
          title="Products & services"
          subtitle="Your reusable line items for invoicing."
        />
        <ProductsView products={products} vatRates={vatRates} categories={categories} />
      </div>
    );
  });
}
