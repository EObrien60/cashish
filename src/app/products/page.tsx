import { boot } from "@/lib/boot";
import { db, schema } from "@/db/client";
import { PageHeader } from "@/components/ui";
import { ProductsView } from "@/components/ProductsView";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  boot();
  const products = db
    .select()
    .from(schema.products)
    .orderBy(schema.products.name)
    .all();
  const vatRates = db
    .select()
    .from(schema.vatRates)
    .orderBy(schema.vatRates.sortOrder)
    .all();
  const categories = db
    .select()
    .from(schema.categories)
    .orderBy(schema.categories.name)
    .all();
  return (
    <div>
      <PageHeader
        title="Products & services"
        subtitle="Your reusable line items for invoicing."
      />
      <ProductsView products={products} vatRates={vatRates} categories={categories} />
    </div>
  );
}
