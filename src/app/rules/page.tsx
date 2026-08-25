import { withTenant } from "@/lib/request-context";
import { listCategories, listVatRates, uncategorisedCount } from "@/lib/lookups";
import { listRules } from "@/lib/rules";
import { PageHeader } from "@/components/ui";
import { RulesView } from "@/components/RulesView";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  return withTenant(async () => {
    const rules = await listRules();
    const [categories, vatRates, uncategorizedCount] = await Promise.all([
      listCategories(),
      listVatRates(),
      uncategorisedCount(),
    ]);

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
  });
}
