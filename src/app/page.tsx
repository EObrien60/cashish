import Link from "next/link";
import { withTenant } from "@/lib/request-context";
import { currentSession } from "@/lib/session";
import { Landing } from "@/components/marketing/Landing";
import { businessHealth } from "@/lib/health";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { HealthView } from "@/components/HealthView";
import { IconUpload, IconPlus } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  // A visitor gets the marketing page; a member gets their dashboard. Same URL,
  // because sending signed-in people to a landing page is its own small insult.
  if (!(await currentSession())) return <Landing />;

  return withTenant(async () => {
    // No period selector on purpose. Runway, what is already committed, how late the
    // debtors are and what needs doing are all facts about today, not about a window —
    // and period-scoped analysis is what /reports is for.
    const health = await businessHealth();

    return (
      <div>
        <PageHeader
          title="Financial health"
          subtitle={`Where the business stands as of ${fmtDate(health.asOf)}.`}
          actions={
            <>
              <Link href="/reports" className="btn-outline">
                Reports
              </Link>
              <Link href="/transactions" className="btn-outline">
                <IconUpload className="h-4 w-4" /> Import statement
              </Link>
              <Link href="/invoices/new" className="btn-primary">
                <IconPlus className="h-4 w-4" /> New invoice
              </Link>
            </>
          }
        />
        <HealthView health={health} />
      </div>
    );
  });
}
