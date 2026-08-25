import { withTenant } from "@/lib/request-context";
import { listCustomers } from "@/lib/customers";
import { listCustomerTotals } from "@/lib/detail";
import { PageHeader } from "@/components/ui";
import { CustomersView } from "@/components/CustomersView";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  return withTenant(async () => {
    const [customers, totals] = await Promise.all([
      listCustomers({ includeArchived: true }),
      listCustomerTotals(),
    ]);
    return (
      <div>
        <PageHeader title="Customers" subtitle="People and businesses you invoice." />
        <CustomersView customers={customers} totals={Object.fromEntries(totals)} />
      </div>
    );
  });
}
