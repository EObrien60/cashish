import { withTenant } from "@/lib/request-context";
import { buildFactSheet } from "@/lib/insights";
import { aiAvailable } from "@/lib/ai";
import { resolvePeriod } from "@/lib/period";
import { PageHeader } from "@/components/ui";
import { PeriodTabs } from "@/components/PeriodTabs";
import { InsightsView } from "@/components/InsightsView";

export const dynamic = "force-dynamic";

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  return withTenant(async () => {
    const sp = await searchParams;
    const period = resolvePeriod(sp.period);
    // The facts render immediately and without a model. The commentary is asked
    // for on demand, so opening the page costs nothing and works offline.
    const facts = await buildFactSheet({ from: period.from, to: period.to });
    const available = await aiAvailable();

    return (
      <div>
        <PageHeader
          title="Where your money went"
          subtitle="Every figure here is computed from your ledger. The commentary is written from those figures — it never calculates its own."
        />
        <div className="mb-6">
          <PeriodTabs active={period.key} basePath="/insights" />
        </div>
        <InsightsView facts={facts} period={period} aiAvailable={available} />
      </div>
    );
  });
}
