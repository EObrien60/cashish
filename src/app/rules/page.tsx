import { boot } from "@/lib/boot";
import { db, schema } from "@/db/client";
import { isNull } from "drizzle-orm";
import { listRules } from "@/lib/rules";
import { PageHeader } from "@/components/ui";
import { RulesView } from "@/components/RulesView";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  boot();
  const rules = listRules();
  const categories = db
    .select()
    .from(schema.categories)
    .orderBy(schema.categories.kind, schema.categories.name)
    .all();
  const vatRates = db.select().from(schema.vatRates).orderBy(schema.vatRates.sortOrder).all();
  const uncategorizedCount = db
    .select({ id: schema.transactions.id })
    .from(schema.transactions)
    .where(isNull(schema.transactions.categoryId))
    .all().length;

  return (
    <div>
      <PageHeader
        title="Categorisation rules"
        subtitle="Teach cashish to file transactions automatically."
      />
      <RulesView
        rules={rules}
        categories={categories}
        vatRates={vatRates}
        uncategorizedCount={uncategorizedCount}
      />
    </div>
  );
}
