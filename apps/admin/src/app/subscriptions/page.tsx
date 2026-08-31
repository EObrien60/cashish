import Link from "next/link";
import { requireAdmin } from "@/lib/admin-session";
import { listSubscriptions } from "@/queries/subscriptions";
import { tenantsWithoutSubscription } from "@/queries/tenants";
import { formatPrice } from "@cashish/core/plans";
import { PageHeader, StatusPill, Empty, when } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  await requireAdmin();
  const rows = await listSubscriptions();
  const missing = await tenantsWithoutSubscription();

  const mrrCents = rows
    .filter((r) => r.status === "active")
    .reduce((sum, r) => sum + (r.priceCents ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Subscriptions"
        subtitle="One per business — a plan describes one set of books. Nothing charges a card; this is the record, not a processor."
      />

      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="adm-card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-faint">Active</div>
          <div className="text-2xl font-semibold tnum mt-1">
            {rows.filter((r) => r.status === "active").length}
          </div>
        </div>
        <div className="adm-card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-faint">
            Monthly, if it were billed
          </div>
          <div className="text-2xl font-semibold tnum mt-1">{formatPrice(mrrCents) || "€0"}</div>
        </div>
        <div className="adm-card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-faint">
            Businesses with none
          </div>
          <div className={`text-2xl font-semibold tnum mt-1 ${missing > 0 ? "text-warn" : ""}`}>
            {missing}
          </div>
        </div>
      </div>

      <div className="adm-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="adm-th">Business</th>
              <th className="adm-th">Plan</th>
              <th className="adm-th text-right">Price</th>
              <th className="adm-th">Status</th>
              <th className="adm-th">Trial ends</th>
              <th className="adm-th">Period ends</th>
              <th className="adm-th">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-paper/70">
                <td className="adm-td">
                  <Link href={`/tenants/${row.tenantId}`} className="font-medium hover:underline underline-offset-4">
                    {row.tenantName}
                  </Link>
                  <div className="adm-mono">{row.slug}</div>
                </td>
                <td className="adm-td">{row.planName}</td>
                <td className="adm-td text-right tnum">{formatPrice(row.priceCents) || "—"}</td>
                <td className="adm-td"><StatusPill status={row.status} /></td>
                <td className="adm-td tnum">{when(row.trialEndsAt)}</td>
                <td className="adm-td tnum">{when(row.currentPeriodEnd)}</td>
                <td className="adm-td text-xs text-ink-faint max-w-xs">{row.note || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty>No subscriptions yet.</Empty>}
      </div>
    </div>
  );
}
