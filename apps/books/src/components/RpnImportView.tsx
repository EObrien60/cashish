"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Rpn, Employee } from "@cashish/core/db";
import { money, fmtDate, pct } from "@/lib/format";
import { Card, EmptyState } from "@/components/ui";
import { IconUpload } from "@/components/icons";
import { importRpnAction } from "@/app/actions";

type Summary = { parsed: number; imported: number; matched: number; unmatched: number; errors: string[] };

export function RpnImportView({
  rpns,
  employees,
  taxYear,
}: {
  rpns: Rpn[];
  employees: Employee[];
  taxYear: number;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [year, setYear] = useState(String(taxYear));
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);

  const empMap = new Map(employees.map((e) => [e.id, e]));

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setSummary(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("taxYear", year);
    const res = await importRpnAction(fd);
    setSummary(res);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  return (
    <div>
      <Card className="mb-4 p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-semibold">Import RPNs</h2>
            <p className="mt-0.5 max-w-2xl text-sm text-ink-faint">
              Upload the Revenue Payroll Notification (RPN) JSON you retrieved
              from ROS. cashish matches each RPN to an employee by PPSN /
              employment ID and uses the figures (credits, cut-off, USC bands,
              PRSI class) to drive payroll deductions. Add your employees first
              so RPNs match.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label className="label">Tax year</label>
              <input
                type="number"
                className="input tabular w-28"
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
            </div>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
            <button className="btn-primary" disabled={busy} onClick={() => fileRef.current?.click()}>
              <IconUpload className="h-4 w-4" /> {busy ? "Importing…" : "Choose RPN JSON"}
            </button>
          </div>
        </div>
        {summary && (
          <div className="mt-4 rounded-lg border border-line bg-paper px-4 py-3 text-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span><strong className="text-brand">{summary.imported}</strong> RPN(s) imported</span>
              <span className="text-ink-faint">{summary.matched} matched to an employee</span>
              {summary.unmatched > 0 && <span className="text-amber-700">{summary.unmatched} unmatched</span>}
            </div>
            {summary.errors.length > 0 && (
              <ul className="mt-2 list-inside list-disc text-money-out">
                {summary.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-line px-5 py-3 font-semibold">
          Current RPNs — {taxYear}
        </div>
        {rpns.length === 0 ? (
          <EmptyState title="No RPNs imported" hint="Import an RPN JSON above to populate employee tax instructions." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line bg-paper/60">
                <tr>
                  <th className="th">Employee</th>
                  <th className="th">RPN</th>
                  <th className="th">Basis</th>
                  <th className="th text-right">Yearly credits</th>
                  <th className="th text-right">SRCOP</th>
                  <th className="th">USC</th>
                  <th className="th">PRSI</th>
                  <th className="th">Match</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rpns.map((r) => {
                  const emp = r.employeeId ? empMap.get(r.employeeId) : null;
                  return (
                    <tr key={r.id} className="hover:bg-paper/50">
                      <td className="td">
                        <div className="font-medium">
                          {r.firstName} {r.familyName}
                        </div>
                        <div className="text-xs tabular text-ink-faint">{r.ppsn}</div>
                      </td>
                      <td className="td tabular">{r.rpnNumber || "—"}</td>
                      <td className="td text-ink-soft">{r.incomeTaxBasis}</td>
                      <td className="td text-right tabular">{money(r.yearlyTaxCredit ?? 0)}</td>
                      <td className="td text-right tabular">{money(r.yearlyRate1CutOff ?? 0)}</td>
                      <td className="td text-ink-soft">{r.uscStatus}</td>
                      <td className="td text-ink-soft">
                        {r.prsiExempt ? "Exempt" : `Class ${r.prsiClass || "—"}`}
                      </td>
                      <td className="td">
                        {emp ? (
                          <span className="badge bg-brand-wash text-brand-dark">{emp.firstName} {emp.familyName}</span>
                        ) : (
                          <span className="badge bg-amber-50 text-amber-700">unmatched</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
