"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Employee } from "@cashish/core/db";
import { money, fmtDate } from "@/lib/format";
import { Card, EmptyState } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { IconPlus, IconEdit } from "@/components/icons";
import { saveEmployeeAction, setEmployeeStatusAction } from "@/app/actions";

type Form = {
  firstName: string;
  familyName: string;
  ppsn: string;
  employerReference: string;
  employmentId: string;
  email: string;
  startDate: string;
  director: string;
  standardGross: string;
  pensionEmployeePct: string;
  prsiClass: string;
};

const BLANK: Form = {
  firstName: "",
  familyName: "",
  ppsn: "",
  employerReference: "",
  employmentId: "1",
  email: "",
  startDate: "",
  director: "",
  standardGross: "0",
  pensionEmployeePct: "0",
  prsiClass: "A",
};

type Paid = { paid: number; count: number; last: string };

export function EmployeesView({
  employees,
  paid = {},
}: {
  employees: Employee[];
  /** Bank payments attached to each employee, keyed by id. */
  paid?: Record<string, Paid>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState<Form>(BLANK);

  function openNew() {
    setEditing(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(e: Employee) {
    setEditing(e);
    setForm({
      firstName: e.firstName,
      familyName: e.familyName,
      ppsn: e.ppsn ?? "",
      employerReference: e.employerReference ?? "",
      employmentId: e.employmentId,
      email: e.email ?? "",
      startDate: e.startDate ?? "",
      director: e.director ?? "",
      standardGross: String(e.standardGross),
      pensionEmployeePct: String((e.pensionEmployeePct ?? 0) * 100),
      prsiClass: e.prsiClass ?? "A",
    });
    setOpen(true);
  }
  function set<K extends keyof Form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  function save() {
    if (!form.familyName.trim() && !form.firstName.trim()) return;
    startTransition(async () => {
      await saveEmployeeAction({
        id: editing?.id,
        firstName: form.firstName,
        familyName: form.familyName,
        ppsn: form.ppsn.toUpperCase().trim(),
        employerReference: form.employerReference,
        employmentId: form.employmentId || "1",
        dob: editing?.dob ?? null,
        addressLine1: editing?.addressLine1 ?? "",
        addressLine2: editing?.addressLine2 ?? "",
        city: editing?.city ?? "",
        email: form.email,
        startDate: form.startDate || null,
        dateOfLeaving: editing?.dateOfLeaving ?? null,
        director: form.director,
        payFrequency: "Monthly",
        standardGross: Number(form.standardGross) || 0,
        pensionEmployeePct: (Number(form.pensionEmployeePct) || 0) / 100,
        prsiClass: form.prsiClass,
        status: editing?.status ?? "active",
      });
      setOpen(false);
      router.refresh();
    });
  }
  function toggleLeaver(e: Employee) {
    startTransition(async () => {
      await setEmployeeStatusAction(
        e.id,
        e.status === "active" ? "leaver" : "active",
        e.status === "active" ? new Date().toISOString().slice(0, 10) : null,
      );
      router.refresh();
    });
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button className="btn-primary" onClick={openNew}>
          <IconPlus className="h-4 w-4" /> New employee
        </button>
      </div>

      <Card className="overflow-hidden">
        {employees.length === 0 ? (
          <EmptyState
            title="No employees yet"
            hint="Add yourself (as a director) or your staff. Then import their RPNs and run payroll."
            action={
              <button className="btn-primary" onClick={openNew}>
                <IconPlus className="h-4 w-4" /> New employee
              </button>
            }
          />
        ) : (
          <table className="w-full">
            <thead className="border-b border-line bg-paper/60">
              <tr>
                <th className="th">Name</th>
                <th className="th">PPSN</th>
                <th className="th">Type</th>
                <th className="th">PRSI</th>
                <th className="th text-right">Monthly gross</th>
                <th className="th text-right">Paid from bank</th>
                <th className="th text-right">Payments</th>
                <th className="th">Status</th>
                <th className="th w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {employees.map((e) => (
                <tr key={e.id} className={`hover:bg-paper/50 ${e.status === "leaver" ? "opacity-60" : ""}`}>
                  <td className="td font-medium">
                    <Link
                      href={`/payroll/employees/${e.id}`}
                      className="text-brand hover:underline"
                    >
                      {e.firstName} {e.familyName}
                    </Link>
                    <div className="text-xs text-ink-faint">Empl. ID {e.employmentId}</div>
                  </td>
                  <td className="td tabular text-ink-soft">{e.ppsn || "—"}</td>
                  <td className="td text-ink-soft">
                    {e.director === "proprietary"
                      ? "Prop. director"
                      : e.director === "non-proprietary"
                        ? "Director"
                        : "Employee"}
                  </td>
                  <td className="td text-ink-soft">Class {e.prsiClass}</td>
                  <td className="td text-right tabular">{money(e.standardGross)}</td>
                  <td className="td text-right tabular">
                    {paid[e.id] ? money(paid[e.id].paid) : "—"}
                  </td>
                  <td className="td text-right tabular text-ink-soft">
                    {paid[e.id]?.count ?? "—"}
                  </td>
                  <td className="td">
                    <span className={`badge ${e.status === "active" ? "bg-brand-wash text-brand-dark" : "bg-black/5 text-ink-faint"}`}>
                      {e.status}
                    </span>
                  </td>
                  <td className="td text-right">
                    <button className="btn-ghost px-2 py-1" onClick={() => openEdit(e)}>
                      <IconEdit className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit employee" : "New employee"}
        wide
        footer={
          <>
            {editing && (
              <button className="btn-outline mr-auto" onClick={() => toggleLeaver(editing)}>
                {editing.status === "active" ? "Mark as leaver" : "Reactivate"}
              </button>
            )}
            <button className="btn-outline" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn-primary" onClick={save}>Save</button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">First name</label>
            <input className="input" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label">Family name</label>
            <input className="input" value={form.familyName} onChange={(e) => set("familyName", e.target.value)} />
          </div>
          <div>
            <label className="label">PPSN</label>
            <input className="input tabular" value={form.ppsn} onChange={(e) => set("ppsn", e.target.value)} placeholder="1234567T" />
          </div>
          <div>
            <label className="label">Employment ID</label>
            <input className="input tabular" value={form.employmentId} onChange={(e) => set("employmentId", e.target.value)} />
          </div>
          <div>
            <label className="label">Employer reference (optional)</label>
            <input className="input" value={form.employerReference} onChange={(e) => set("employerReference", e.target.value)} />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div>
            <label className="label">Employment type</label>
            <select className="input" value={form.director} onChange={(e) => set("director", e.target.value)}>
              <option value="">Employee</option>
              <option value="proprietary">Proprietary director (&gt;15%)</option>
              <option value="non-proprietary">Non-proprietary director</option>
            </select>
          </div>
          <div>
            <label className="label">PRSI class</label>
            <select className="input" value={form.prsiClass} onChange={(e) => set("prsiClass", e.target.value)}>
              <option value="A">A (employees)</option>
              <option value="S">S (prop. directors / self-employed)</option>
              <option value="J">J</option>
              <option value="M">M (no PRSI)</option>
            </select>
          </div>
          <div>
            <label className="label">Start date</label>
            <input type="date" className="input" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
          </div>
          <div>
            <label className="label">Default monthly gross (€)</label>
            <input type="number" step="0.01" className="input tabular" value={form.standardGross} onChange={(e) => set("standardGross", e.target.value)} />
          </div>
          <div>
            <label className="label">Employee pension (% of gross)</label>
            <input type="number" step="0.1" className="input tabular" value={form.pensionEmployeePct} onChange={(e) => set("pensionEmployeePct", e.target.value)} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
