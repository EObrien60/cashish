"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Payslip, Employee, PayRun } from "@cashish/core/db";
import { money, round2, fmtDate } from "@/lib/format";
import { Card, StatusBadge } from "@/components/ui";
import { IconDownload, IconFile, IconCheck, IconTrash, IconRepeat } from "@/components/icons";
import {
  updatePayslipAction,
  recomputePayslipAction,
  setPayRunStatusAction,
  deletePayRunAction,
} from "@/app/actions";

type Slip = Payslip & { employee: Employee };
type Run = PayRun & { slips: Slip[] };

const MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Editable numeric fields shown in the grid.
const FIELDS: { key: keyof Payslip; label: string }[] = [
  { key: "grossPay", label: "Gross" },
  { key: "incomeTaxPaid", label: "PAYE" },
  { key: "uscPaid", label: "USC" },
  { key: "employeePrsi", label: "EE PRSI" },
  { key: "employerPrsi", label: "ER PRSI" },
  { key: "pensionEmployee", label: "Pension" },
  { key: "lptDeducted", label: "LPT" },
  { key: "otherDeductions", label: "Other" },
];

function netOf(s: Pick<Payslip, "grossPay" | "pensionEmployee" | "incomeTaxPaid" | "employeePrsi" | "uscPaid" | "lptDeducted" | "otherDeductions">) {
  return round2(s.grossPay - s.pensionEmployee - s.incomeTaxPaid - s.employeePrsi - s.uscPaid - s.lptDeducted - s.otherDeductions);
}

export function PayRunBuilder({ run }: { run: Run }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [slips, setSlips] = useState<Slip[]>(run.slips);
  const finalised = run.status === "finalised";

  useEffect(() => setSlips(run.slips), [run.slips]);

  const totals = slips.reduce(
    (a, s) => ({
      gross: a.gross + s.grossPay,
      paye: a.paye + s.incomeTaxPaid,
      usc: a.usc + s.uscPaid,
      eePrsi: a.eePrsi + s.employeePrsi,
      erPrsi: a.erPrsi + s.employerPrsi,
      net: a.net + s.netPay,
    }),
    { gross: 0, paye: 0, usc: 0, eePrsi: 0, erPrsi: 0, net: 0 },
  );

  function editLocal(id: string, key: keyof Payslip, value: number) {
    setSlips((ls) =>
      ls.map((s) => {
        if (s.id !== id) return s;
        const next = { ...s, [key]: value } as Slip;
        next.netPay = netOf(next);
        return next;
      }),
    );
  }
  function save(id: string, key: keyof Payslip, value: number) {
    startTransition(async () => {
      await updatePayslipAction(id, { [key]: value } as Partial<Payslip>);
    });
  }
  function recompute(id: string) {
    startTransition(async () => {
      await recomputePayslipAction(id);
      router.refresh();
    });
  }
  function recomputeAll() {
    startTransition(async () => {
      for (const s of slips) await recomputePayslipAction(s.id);
      router.refresh();
    });
  }
  function finalise() {
    startTransition(async () => {
      await setPayRunStatusAction(run.id, finalised ? "draft" : "finalised");
      router.refresh();
    });
  }
  function del() {
    if (!confirm("Delete this pay run and its payslips?")) return;
    startTransition(async () => {
      await deletePayRunAction(run.id);
      router.push("/payroll");
    });
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/payroll" className="text-sm text-ink-faint hover:text-ink">← Payroll</Link>
          <h1 className="text-2xl font-bold tracking-tight">{MONTHS[run.periodNo]} {run.taxYear}</h1>
          <StatusBadge status={run.status} />
          <span className="text-sm text-ink-faint">pay date {fmtDate(run.payDate)}</span>
        </div>
        <div className="flex items-center gap-2">
          {!finalised && (
            <button className="btn-outline" onClick={recomputeAll}>
              <IconRepeat className="h-4 w-4" /> Recompute all
            </button>
          )}
          <a href={`/api/payroll/runs/${run.id}/psr`} className="btn-outline">
            <IconDownload className="h-4 w-4" /> Export PSR (ROS)
          </a>
          <button className={finalised ? "btn-outline" : "btn-primary"} onClick={finalise}>
            <IconCheck className="h-4 w-4" /> {finalised ? "Reopen" : "Finalise"}
          </button>
        </div>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead className="border-b border-line bg-paper/60">
            <tr>
              <th className="th sticky left-0 bg-paper/60">Employee</th>
              {FIELDS.map((f) => (
                <th key={f.key} className="th text-right">{f.label}</th>
              ))}
              <th className="th text-right">Net</th>
              <th className="th w-20"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {slips.map((s) => (
              <tr key={s.id} className="hover:bg-paper/40">
                <td className="td sticky left-0 bg-card">
                  <div className="font-medium whitespace-nowrap">
                    {s.employee.firstName} {s.employee.familyName}
                  </div>
                  <div className="text-xs text-ink-faint">
                    {s.incomeTaxBasis} · Class {s.prsiClass}
                    {s.exclusionOrder ? " · excl." : ""}
                    {!s.rpnNumber && <span className="text-amber-600"> · no RPN</span>}
                  </div>
                </td>
                {FIELDS.map((f) => (
                  <td key={f.key} className="td">
                    <input
                      type="number"
                      step="0.01"
                      disabled={finalised}
                      className="input tabular w-24 py-1 text-right disabled:bg-paper/40"
                      value={String(s[f.key] as number)}
                      onChange={(e) => editLocal(s.id, f.key, Number(e.target.value) || 0)}
                      onBlur={(e) => !finalised && save(s.id, f.key, Number(e.target.value) || 0)}
                    />
                  </td>
                ))}
                <td className="td text-right tabular font-semibold">{money(s.netPay)}</td>
                <td className="td">
                  <div className="flex items-center justify-end gap-1">
                    {!finalised && (
                      <button className="btn-ghost px-2 py-1" title="Recompute from RPN" onClick={() => recompute(s.id)}>
                        <IconRepeat className="h-4 w-4" />
                      </button>
                    )}
                    <Link href={`/payroll/payslips/${s.id}`} className="btn-ghost px-2 py-1" title="Payslip">
                      <IconFile className="h-4 w-4" />
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-line bg-paper/60">
            <tr className="font-semibold">
              <td className="td sticky left-0 bg-paper/60">Totals ({slips.length})</td>
              <td className="td text-right tabular">{money(totals.gross)}</td>
              <td className="td text-right tabular">{money(totals.paye)}</td>
              <td className="td text-right tabular">{money(totals.usc)}</td>
              <td className="td text-right tabular">{money(totals.eePrsi)}</td>
              <td className="td text-right tabular">{money(totals.erPrsi)}</td>
              <td className="td" colSpan={2}></td>
              <td className="td text-right tabular text-brand">{money(totals.net)}</td>
              <td className="td"></td>
            </tr>
          </tfoot>
        </table>
      </Card>

      <div className="mt-4 flex items-center justify-between">
        <p className="max-w-2xl text-xs text-ink-faint">
          Deductions are computed from each employee's RPN (lighter calc) and are
          fully editable — adjust then re-finalise. PRSI uses default class rates;
          verify against the current PRSI Employer Guide. The PSR export follows
          Revenue's PAYE Modernisation data-items spec — validate in ROS before
          filing. This is not tax advice.
        </p>
        {!finalised && (
          <button className="btn-danger" onClick={del}>
            <IconTrash className="h-4 w-4" /> Delete run
          </button>
        )}
      </div>
    </div>
  );
}
