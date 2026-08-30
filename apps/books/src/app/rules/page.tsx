import { withTenant } from "@/lib/request-context";
import { listCategories, listVatRates, uncategorisedCount } from "@/lib/lookups";
import { listCustomers } from "@/lib/customers";
import { listVendors } from "@/lib/vendors";
import { listPeople, fullName } from "@/lib/people";
import { listRules } from "@/lib/rules";
import { PageHeader } from "@/components/ui";
import { RulesView } from "@/components/RulesView";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  return withTenant(async () => {
    const rules = await listRules();
    const [categories, vatRates, uncategorizedCount, customers, vendors, people] =
      await Promise.all([
        listCategories(),
        listVatRates(),
        uncategorisedCount(),
        listCustomers({ includeArchived: true }),
        listVendors({ includeArchived: true }),
        listPeople({ includeLeavers: true }),
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
          customers={customers.map((c) => ({ id: c.id, name: c.name }))}
          vendors={vendors.map((v) => ({ id: v.id, name: v.name }))}
          people={people.map((p) => ({ id: p.id, name: fullName(p) }))}
        />
      </div>
    );
  });
}
