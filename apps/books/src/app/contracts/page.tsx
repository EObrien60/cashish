import { withTenant } from "@/lib/request-context";
import { listContracts, committedButUninvoiced } from "@/lib/contracts";
import { listCustomers } from "@/lib/customers";
import { money } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui";
import { ContractsView } from "@/components/ContractsView";

export const dynamic = "force-dynamic";

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ closed?: string }>;
}) {
  return withTenant(async () => {
    const sp = await searchParams;
    const includeClosed = sp.closed === "1";
    const [contracts, customers, committed] = await Promise.all([
      listContracts({ includeClosed }),
      listCustomers(),
      committedButUninvoiced(),
    ]);

    return (
      <div>
        <PageHeader
          title="Contracts"
          subtitle="What you agreed, what it is worth, what has been billed against it, and where the signed copy is."
        />

        {committed.total > 0 && (
          <Card className="mb-6">
            <div className="text-xs uppercase tracking-wide text-ink-faint">
              Agreed but not yet invoiced
            </div>
            <div className="text-2xl font-bold mt-1">{money(committed.total)}</div>
            <p className="text-sm text-ink-faint mt-1">
              Across {committed.contracts.length} contract
              {committed.contracts.length === 1 ? "" : "s"}. The cash flow forecast only counts
              invoices that exist, so this is the part it cannot see yet.
            </p>
          </Card>
        )}

        <ContractsView
          contracts={contracts}
          customers={customers.map((c) => ({ id: c.id, name: c.name }))}
          includeClosed={includeClosed}
        />
      </div>
    );
  });
}
