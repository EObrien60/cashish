import Link from "next/link";
import { withTenant } from "@/lib/request-context";
import { getSettings } from "@/lib/lookups";
import { getPayslip } from "@/lib/payroll";
import { money, fmtDate } from "@/lib/format";
import { Card } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

const MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between py-1.5 ${strong ? "border-t border-line font-semibold" : ""}`}>
      <span className={strong ? "" : "text-ink-soft"}>{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}

export default async function PayslipPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return withTenant(async () => {
    const { id } = await params;
    const slip = await getPayslip(id);
    if (!slip || !slip.employee || !slip.run) notFound();
    const s = await getSettings();
    const e = slip.employee;
    const run = slip.run;

    const totalDeductions = money(
      slip.incomeTaxPaid + slip.uscPaid + slip.employeePrsi + slip.pensionEmployee + slip.lptDeducted + slip.otherDeductions,
    );

    return (
      <div>
        <div className="no-print mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href={`/payroll/runs/${run.id}`} className="text-sm text-ink-faint hover:text-ink">← Pay run</Link>
            <h1 className="text-2xl font-bold tracking-tight">Payslip</h1>
          </div>
          <PrintButton />
        </div>

        <Card className="print-sheet mx-auto max-w-2xl p-8">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xl font-bold text-brand">{s?.businessName}</div>
              <div className="mt-1 text-sm text-ink-soft">
                {s?.addressLine1 && <div>{s.addressLine1}</div>}
                {s?.city && <div>{s.city}</div>}
                {s?.employerRegNumber && <div className="mt-1">Employer reg: {s.employerRegNumber}</div>}
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold tracking-tight">PAYSLIP</div>
              <div className="mt-1 text-sm text-ink-soft">{MONTHS[run.periodNo]} {run.taxYear}</div>
              <div className="text-sm tabular text-ink-soft">Pay date {fmtDate(run.payDate)}</div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 rounded-lg bg-paper p-4 text-sm">
            <div>
              <div className="font-semibold">{e.firstName} {e.familyName}</div>
              <div className="text-ink-soft">PPSN {e.ppsn || "—"}</div>
              <div className="text-ink-soft">Employment ID {e.employmentId}</div>
            </div>
            <div className="text-right text-ink-soft">
              <div>Basis: {slip.incomeTaxBasis}</div>
              <div>PRSI class {slip.prsiClass}{slip.prsiExempt ? " (exempt)" : ""}</div>
              <div>RPN {slip.rpnNumber || "—"}</div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-8">
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Payments</div>
              <Row label="Gross pay" value={money(slip.grossPay)} />
              <Row label="Total payments" value={money(slip.grossPay)} strong />
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Deductions</div>
              <Row label="PAYE (income tax)" value={money(slip.incomeTaxPaid)} />
              <Row label="USC" value={money(slip.uscPaid)} />
              <Row label="PRSI (employee)" value={money(slip.employeePrsi)} />
              {slip.pensionEmployee > 0 && <Row label="Pension" value={money(slip.pensionEmployee)} />}
              {slip.lptDeducted > 0 && <Row label="Local Property Tax" value={money(slip.lptDeducted)} />}
              {slip.otherDeductions > 0 && <Row label={slip.otherDeductionsLabel || "Other"} value={money(slip.otherDeductions)} />}
              <Row label="Total deductions" value={totalDeductions} strong />
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between rounded-lg bg-brand-wash px-5 py-4">
            <span className="font-semibold text-brand-dark">Net pay</span>
            <span className="text-2xl font-bold tabular text-brand-dark">{money(slip.netPay)}</span>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-4 text-xs text-ink-faint">
            <div>
              <div className="font-medium text-ink-soft">Tax credits (period)</div>
              <div className="tabular">{money(slip.taxCreditsThisPeriod)}</div>
            </div>
            <div>
              <div className="font-medium text-ink-soft">Cut-off (period)</div>
              <div className="tabular">{money(slip.standardRateCutOff)}</div>
            </div>
            <div>
              <div className="font-medium text-ink-soft">Employer PRSI</div>
              <div className="tabular">{money(slip.employerPrsi)}</div>
            </div>
          </div>
        </Card>
      </div>
    );
  });
}
