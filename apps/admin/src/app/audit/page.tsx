import Link from "next/link";
import { requireAdmin } from "@/lib/admin-session";
import { listAudit } from "@/lib/audit";
import { PageHeader, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Read-only, and there is no delete anywhere — the log is append-only. */
export default async function AuditPage() {
  await requireAdmin();
  const rows = await listAudit(300);

  return (
    <div>
      <PageHeader
        title="Audit"
        subtitle="Every change made from this console, newest first. Append-only."
      />

      <div className="adm-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="adm-th w-44">When</th>
              <th className="adm-th">Who</th>
              <th className="adm-th">Action</th>
              <th className="adm-th">Subject</th>
              <th className="adm-th">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="align-top">
                <td className="adm-td tnum text-ink-faint">
                  {row.createdAt.slice(0, 19).replace("T", " ")}
                </td>
                <td className="adm-td">{row.adminEmail}</td>
                <td className="adm-td adm-mono">{row.action}</td>
                <td className="adm-td">
                  {row.subjectType === "tenant" && row.tenantId ? (
                    <Link href={`/tenants/${row.tenantId}`} className="hover:underline underline-offset-4">
                      {row.subjectType}
                    </Link>
                  ) : row.subjectType === "user" ? (
                    <Link href={`/users/${row.subjectId}`} className="hover:underline underline-offset-4">
                      {row.subjectType}
                    </Link>
                  ) : (
                    row.subjectType
                  )}
                  <div className="adm-mono">{row.subjectId.slice(0, 8)}…</div>
                </td>
                <td className="adm-td">
                  <div className="text-xs font-mono whitespace-pre-wrap break-all text-ink-soft max-w-xl leading-relaxed">
                    {row.before && <div className="text-danger">− {row.before}</div>}
                    {row.after && <div className="text-ok">+ {row.after}</div>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty>Nothing has been changed from the console yet.</Empty>}
      </div>
    </div>
  );
}
