import Link from "next/link";
import { requireAdmin } from "@/lib/admin-session";
import { listUsers } from "@/queries/users";
import { PageHeader, Search, Empty, when } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const { q } = await searchParams;
  const rows = await listUsers(q);

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle={`${rows.length} ${rows.length === 1 ? "person" : "people"}`}
        right={<Search action="/users" placeholder="email or name" defaultValue={q} />}
      />

      <div className="adm-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="adm-th">Person</th>
              <th className="adm-th text-right">Businesses</th>
              <th className="adm-th">State</th>
              <th className="adm-th">Joined</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-paper/70">
                <td className="adm-td">
                  <Link href={`/users/${row.id}`} className="font-medium hover:underline underline-offset-4">
                    {row.email}
                  </Link>
                  {row.name && <div className="text-xs text-ink-faint">{row.name}</div>}
                </td>
                <td className="adm-td text-right tnum">{row.membershipCount}</td>
                <td className="adm-td">
                  {row.disabledAt ? (
                    <span className="adm-pill bg-danger/10 text-danger">disabled</span>
                  ) : (
                    <span className="adm-pill bg-ok/10 text-ok">active</span>
                  )}
                </td>
                <td className="adm-td tnum">{when(row.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty>Nobody matches that.</Empty>}
      </div>
    </div>
  );
}
