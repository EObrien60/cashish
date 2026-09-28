import { withTenant } from "@/lib/request-context";
import { getSettings, listCategories, listProducts, listVatRates } from "@/lib/lookups";
import { ownShopPath } from "@/lib/shop";
import { listProductsWithUsage } from "@/lib/detail";
import { PageHeader } from "@/components/ui";
import { ProductsView } from "@/components/ProductsView";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  return withTenant(async () => {
    const [products, vatRates, categories, usage, settings, shopPath] = await Promise.all([
      listProducts({ includeArchived: true }),
      listVatRates(),
      listCategories(),
      listProductsWithUsage(),
      getSettings(),
      ownShopPath(),
    ]);
    return (
      <div>
        <PageHeader
          title="Products & services"
          subtitle="Your reusable line items for invoicing."
        />
        <ProductsView
          products={products}
          vatRates={vatRates}
          categories={categories}
          usage={Object.fromEntries(usage)}
          shopUrl={settings.shopEnabled ? shopPath : null}
        />
      </div>
    );
  });
}
