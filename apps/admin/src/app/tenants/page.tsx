import Link from "next/link";
import { requireAdmin } from "@/lib/admin-session";
import { listTenants, tenantsWithoutSubscription } from "@/queries/tenants";
import { PageHeader, StatusPill, Search, Empty, when } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const { q } = await searchParams;
  const rows = await listTenants(q);
  const unsubscribed = await tenantsWithoutSubscription();

  return (
    <div>
      <PageHeader
        title="Tenants"
        subtitle={`${rows.length} ${rows.length === 1 ? "business" : "businesses"}${
          unsubscribed > 0 ? ` · ${unsubscribed} without a subscription` : ""
        }`}
        right={<Search action="/tenants" placeholder="slug, name or id" defaultValue={q} />}
      />

      <div className="adm-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="adm-th">Business</th>
              <th className="adm-th">Plan</th>
              <th className="adm-th">Status</th>
              <th className="adm-th text-right">Members</th>
              <th className="adm-th text-right">Transactions</th>
              <th className="adm-th text-right">Invoices</th>
              <th className="adm-th">Last activity</th>
              <th className="adm-th">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-paper/70">
                <td className="adm-td">
                  <Link href={`/tenants/${row.id}`} className="font-medium hover:underline underline-offset-4">
                    {row.name}
                  </Link>
                  <div className="adm-mono">{row.slug}</div>
                </td>
                <td className="adm-td">{row.planCode ?? "—"}</td>
                <td className="adm-td">
                  <StatusPill status={row.status} />
                </td>
                <td className="adm-td text-right tnum">{row.memberCount}</td>
                <td className="adm-td text-right tnum">{row.transactionCount}</td>
                <td className="adm-td text-right tnum">{row.invoiceCount}</td>
                <td className="adm-td tnum">{when(row.lastActivity)}</td>
                <td className="adm-td tnum">{when(row.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty>No business matches that.</Empty>}
      </div>
    </div>
  );
}
