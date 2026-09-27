import { withTenant } from "@/lib/request-context";
import { listContractors, contractorTotals, listTimesheets } from "@/lib/contractors";
import { PageHeader } from "@/components/ui";
import { ContractorsView } from "@/components/ContractorsView";

export const dynamic = "force-dynamic";

export default async function ContractorsPage() {
  return withTenant(async () => {
    const [contractors, totals, timesheets] = await Promise.all([
      listContractors(),
      contractorTotals(),
      listTimesheets(),
    ]);
    return (
      <div>
        <PageHeader
          title="Contractors"
          subtitle="Who bills you by the hour, their timesheets, and the platform charges that paid them."
        />
        <ContractorsView
          contractors={contractors}
          totals={Object.fromEntries(totals)}
          timesheets={timesheets}
        />
      </div>
    );
  });
}
