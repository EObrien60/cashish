import Link from "next/link";
import { requireAdmin } from "@/lib/admin-session";
import { listTenants, tenantsWithoutSubscription, tenantKindCounts } from "@/queries/tenants";
import { PageHeader, StatusPill, Search, Empty, when } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string }>;
}) {
  await requireAdmin();
  const { q, kind } = await searchParams;
  const rows = await listTenants(q, kind);
  const unsubscribed = await tenantsWithoutSubscription();
  const kinds = await tenantKindCounts();

  return (
    <div>
      <PageHeader
        title="Tenants"
        subtitle={`${rows.length} ${rows.length === 1 ? "book" : "books"} · ${
          kinds.business
        } business, ${kinds.personal} personal${
          unsubscribed > 0 ? ` · ${unsubscribed} without a subscription` : ""
        }`}
        right={<Search action="/tenants" placeholder="slug, name or id" defaultValue={q} />}
      />

      {/* Filtering by kind, because "why has this tenant no invoices?" answers
          itself once you can see it is somebody's household. */}
      <div className="mb-3 flex gap-2 text-sm">
        {[
          { key: "", label: `All (${kinds.business + kinds.personal})` },
          { key: "business", label: `Business (${kinds.business})` },
          { key: "personal", label: `Personal (${kinds.personal})` },
        ].map((tab) => {
          const active = (kind ?? "") === tab.key;
          const href = tab.key
            ? `/tenants?kind=${tab.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`
            : `/tenants${q ? `?q=${encodeURIComponent(q)}` : ""}`;
          return (
            <Link
              key={tab.key || "all"}
              href={href}
              className={`rounded-lg border px-3 py-1.5 ${
                active ? "border-ink bg-ink text-paper" : "border-line hover:border-ink/40"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <div className="adm-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="adm-th">Book</th>
              <th className="adm-th">Kind</th>
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
                <td className="adm-td">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      row.kind === "personal"
                        ? "bg-violet-50 text-violet-700"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {row.kind === "personal" ? "Personal" : "Business"}
                  </span>
                  <span className="adm-mono ml-1.5">
                    {row.region} · {row.currency}
                  </span>
                </td>
                <td className="adm-td">{row.planCode ?? "—"}</td>
                <td className="adm-td">
                  <StatusPill status={row.status} />
                </td>
                <td className="adm-td text-right tnum">{row.memberCount}</td>
                <td className="adm-td text-right tnum">{row.transactionCount}</td>
                <td className="adm-td text-right tnum">
                  {row.kind === "personal" ? (
                    <span className="text-ink-faint" title="personal books do not invoice">
                      n/a
                    </span>
                  ) : (
                    row.invoiceCount
                  )}
                </td>
                <td className="adm-td tnum">{when(row.lastActivity)}</td>
                <td className="adm-td tnum">{when(row.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty>No book matches that.</Empty>}
      </div>
    </div>
  );
}
