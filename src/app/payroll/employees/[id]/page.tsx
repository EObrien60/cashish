import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@/lib/request-context";
import { getPersonDetail, fullName } from "@/lib/people";
import { money, fmtDate } from "@/lib/format";
import { Card, PageHeader, StatCard, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return withTenant(async () => {
    const detail = await getPersonDetail(id);
    if (!detail) notFound();
    const { employee, transactions, payslips, totals, byYear, rpnCount } = detail;

    return (
      <div>
        <PageHeader
          title={fullName(employee) || "Unnamed"}
          subtitle={
            [
              employee.status === "leaver" ? "Left" : "Active",
              employee.email,
              employee.ppsn ? `PPSN ${employee.ppsn}` : null,
              employee.startDate ? `started ${fmtDate(employee.startDate)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")
          }
          actions={
            <Link href="/payroll/employees" className="btn-outline">
              All people
            </Link>
          }
        />

        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Paid from the bank"
            value={money(totals.paid)}
            tone="out"
            sub={`${totals.count} payment(s)`}
          />
          <StatCard
            label="First paid"
            value={totals.firstPaid ? fmtDate(totals.firstPaid) : "—"}
            sub={totals.lastPaid ? `last ${fmtDate(totals.lastPaid)}` : undefined}
          />
          <StatCard
            label="Payslips"
            value={String(payslips.length)}
            sub={payslips.length ? `gross ${money(totals.payslipGross)}` : "none yet"}
          />
          {totals.receivedCount > 0 ? (
            <StatCard
              label="Received from them"
              value={money(totals.receivedFrom)}
              tone="in"
              sub={`${totals.receivedCount} inflow(s) — e.g. director funding`}
            />
          ) : (
            <StatCard
              label="RPNs on file"
              value={String(rpnCount)}
              sub={rpnCount ? undefined : "not needed to record payments"}
            />
          )}
        </div>

        {payslips.length === 0 && totals.count > 0 && (
          <Card className="mb-6 p-4 text-sm text-ink-soft">
            These are bank payments attached to this person. No payslips have been
            produced, and none are required for the figures above — run payroll only
            when you need to file.
          </Card>
        )}

        {byYear.length > 1 && (
          <>
            <h2 className="mb-2 text-sm font-semibold">By year</h2>
            <Card className="mb-6 overflow-hidden">
              <table className="w-full">
                <thead className="border-b border-line bg-paper/60">
                  <tr>
                    <th className="th">Year</th>
                    <th className="th text-right">Payments</th>
                    <th className="th text-right">Paid</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {byYear.map((y) => (
                    <tr key={y.year} className="hover:bg-paper/50">
                      <td className="td font-medium">{y.year}</td>
                      <td className="td tabular text-right text-ink-soft">{y.count}</td>
                      <td className="td tabular text-right">{money(y.paid)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}

        <h2 className="mb-2 text-sm font-semibold">Payments</h2>
        <Card className="mb-6 overflow-hidden">
          {transactions.length === 0 ? (
            <EmptyState
              title="No payments attached yet"
              hint="Attach them from the Transactions screen, or with a rule that matches the name."
            />
          ) : (
            <table className="w-full">
              <thead className="border-b border-line bg-paper/60">
                <tr>
                  <th className="th">Date</th>
                  <th className="th">Description</th>
                  <th className="th">Reference</th>
                  <th className="th text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {transactions.map((t) => (
                  <tr key={t.id} className={`hover:bg-paper/50 ${t.excluded ? "opacity-50" : ""}`}>
                    <td className="td text-ink-soft">{fmtDate(t.bookedDate)}</td>
                    <td className="td">
                      {t.description || "—"}
                      {t.excluded && (
                        <span className="ml-2 text-xs text-ink-faint">
                          excluded{t.excludedReason ? ` — ${t.excludedReason}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="td text-ink-faint">{t.reference || "—"}</td>
                    <td className="td tabular text-right">{money(Math.abs(t.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {payslips.length > 0 && (
          <>
            <h2 className="mb-2 text-sm font-semibold">Payslips</h2>
            <Card className="overflow-hidden">
              <table className="w-full">
                <thead className="border-b border-line bg-paper/60">
                  <tr>
                    <th className="th">Pay date</th>
                    <th className="th">Period</th>
                    <th className="th text-right">Gross</th>
                    <th className="th text-right">PAYE</th>
                    <th className="th text-right">PRSI</th>
                    <th className="th text-right">USC</th>
                    <th className="th text-right">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {payslips.map((p) => (
                    <tr key={p.id} className="hover:bg-paper/50">
                      <td className="td">
                        <Link href={`/payroll/payslips/${p.id}`} className="text-brand hover:underline">
                          {fmtDate(p.payDate)}
                        </Link>
                      </td>
                      <td className="td text-ink-soft">
                        {p.taxYear} · {p.periodNo}
                      </td>
                      <td className="td tabular text-right">{money(p.grossPay)}</td>
                      <td className="td tabular text-right text-ink-soft">{money(p.incomeTaxPaid)}</td>
                      <td className="td tabular text-right text-ink-soft">{money(p.employeePrsi)}</td>
                      <td className="td tabular text-right text-ink-soft">{money(p.uscPaid)}</td>
                      <td className="td tabular text-right font-medium">{money(p.netPay)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </div>
    );
  });
}
