import Link from "next/link";
import { withTenant } from "@/lib/request-context";
import { getSettings, listRpns } from "@/lib/lookups";
import { listEmployees, listPayRuns } from "@/lib/payroll";
import { money, fmtDate } from "@/lib/format";
import { Card, PageHeader, StatCard, EmptyState, StatusBadge } from "@/components/ui";
import { NewPayRunButton } from "@/components/NewPayRunButton";
import { IconUsers, IconVat, IconChevron } from "@/components/icons";

export const dynamic = "force-dynamic";

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function PayrollPage() {
  return withTenant(async () => {
    const employees = await listEmployees();
    const activeCount = employees.filter((e) => e.status === "active").length;
    const runs = await listPayRuns();
    const taxYear = new Date().getFullYear();
    const [rpnRows, settings] = await Promise.all([listRpns(taxYear), getSettings()]);
    const rpnCount = rpnRows.length;
    const nextPeriod = Math.min(12, new Date().getMonth() + 1);

    return (
      <div>
        <PageHeader
          title="Payroll"
          subtitle="Irish PAYE Modernisation — RPN-driven, monthly."
          actions={<NewPayRunButton defaultYear={taxYear} defaultPeriod={nextPeriod} disabled={activeCount === 0} />}
        />

        {!settings?.employerRegNumber && (
          <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Add your <strong>Employer Registration Number</strong> in{" "}
            <Link href="/settings" className="underline">Settings</Link> — it's required on the ROS payroll submission.
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <Link href="/payroll/employees">
            <StatCard label="Employees" value={activeCount} sub={`${employees.length} total · manage →`} tone="brand" />
          </Link>
          <Link href="/payroll/rpns">
            <StatCard label={`RPNs (${taxYear})`} value={rpnCount} sub="import / view →" tone="brand" />
          </Link>
          <StatCard label="Pay runs" value={runs.length} sub="this database" />
        </div>

        <Card className="mt-4 overflow-hidden">
          <div className="border-b border-line px-5 py-3 font-semibold">Pay runs</div>
          {runs.length === 0 ? (
            <EmptyState
              title="No pay runs yet"
              hint={activeCount === 0 ? "Add an employee first, then run payroll." : "Create your first monthly pay run."}
              action={
                activeCount === 0 ? (
                  <Link href="/payroll/employees" className="btn-primary"><IconUsers className="h-4 w-4" /> Add employees</Link>
                ) : (
                  <NewPayRunButton defaultYear={taxYear} defaultPeriod={nextPeriod} />
                )
              }
            />
          ) : (
            <table className="w-full">
              <thead className="border-b border-line bg-paper/60">
                <tr>
                  <th className="th">Period</th>
                  <th className="th">Pay date</th>
                  <th className="th">Employees</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Gross</th>
                  <th className="th text-right">Net</th>
                  <th className="th w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {runs.map((r) => (
                  <tr key={r.id} className="hover:bg-paper/50">
                    <td className="td font-medium">
                      <Link href={`/payroll/runs/${r.id}`} className="text-brand hover:underline">
                        {MONTHS[r.periodNo]} {r.taxYear}
                      </Link>
                    </td>
                    <td className="td tabular text-ink-soft">{fmtDate(r.payDate)}</td>
                    <td className="td tabular">{r.employees}</td>
                    <td className="td"><StatusBadge status={r.status} /></td>
                    <td className="td text-right tabular">{money(r.gross)}</td>
                    <td className="td text-right tabular font-medium">{money(r.net)}</td>
                    <td className="td text-right">
                      <Link href={`/payroll/runs/${r.id}`} className="text-ink-faint hover:text-brand">
                        <IconChevron className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    );
  });
}
