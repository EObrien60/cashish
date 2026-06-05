"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Modal";
import { IconPlus } from "@/components/icons";
import { createPayRunAction } from "@/app/actions";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function NewPayRunButton({
  defaultYear,
  defaultPeriod,
  disabled,
}: {
  defaultYear: number;
  defaultPeriod: number;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(String(defaultYear));
  const [period, setPeriod] = useState(String(defaultPeriod));
  const [payDate, setPayDate] = useState(`${defaultYear}-${String(defaultPeriod).padStart(2, "0")}-28`);
  const [payDateEdited, setPayDateEdited] = useState(false);

  // Keep the pay date on the selected month's 28th until the user overrides it.
  function syncPayDate(y: string, p: string) {
    if (!payDateEdited) setPayDate(`${y}-${String(Number(p)).padStart(2, "0")}-28`);
  }

  function create() {
    startTransition(async () => {
      const id = await createPayRunAction(Number(year), Number(period), payDate);
      setOpen(false);
      router.push(`/payroll/runs/${id}`);
    });
  }

  return (
    <>
      <button className="btn-primary" disabled={disabled} onClick={() => setOpen(true)}>
        <IconPlus className="h-4 w-4" /> New pay run
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New monthly pay run"
        footer={
          <>
            <button className="btn-outline" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn-primary" onClick={create}>Create run</button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Tax year</label>
              <input type="number" className="input tabular" value={year} onChange={(e) => { setYear(e.target.value); syncPayDate(e.target.value, period); }} />
            </div>
            <div>
              <label className="label">Month</label>
              <select className="input" value={period} onChange={(e) => { setPeriod(e.target.value); syncPayDate(year, e.target.value); }}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>{m} (period {i + 1})</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Pay date</label>
            <input type="date" className="input" value={payDate} onChange={(e) => { setPayDate(e.target.value); setPayDateEdited(true); }} />
          </div>
          <p className="text-xs text-ink-faint">
            A payslip is created for every active employee using their default
            monthly gross and current RPN. You can adjust each before finalising.
          </p>
        </div>
      </Modal>
    </>
  );
}
