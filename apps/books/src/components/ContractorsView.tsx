"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Contractor } from "@cashish/core/db";
import type { TimesheetRow } from "@/lib/contractors";
import { money, moneyIn, fmtDate, round2 } from "@/lib/format";
import { Card, EmptyState, StatCard, StatusBadge } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { IconPlus, IconEdit, IconUpload, IconTrash } from "@/components/icons";
import {
  saveContractorAction,
  saveTimesheetAction,
  deleteTimesheetAction,
  importUpworkCsvAction,
  suggestTimesheetPaymentsAction,
  linkTimesheetPaymentAction,
  unlinkTimesheetPaymentAction,
} from "@/app/actions";

type Totals = { hours: number; billed: number; paid: number; unpaid: number; count: number };
type Summary = Awaited<ReturnType<typeof importUpworkCsvAction>>;
type Suggestion = Awaited<ReturnType<typeof suggestTimesheetPaymentsAction>>[number];

const EMPTY_CONTRACTOR = { name: "", email: "", platform: "upwork" as "upwork" | "direct", platformRef: "", defaultRate: "", status: "active" as "active" | "inactive" };
const EMPTY_SHEET = { contractorId: "", periodStart: "", periodEnd: "", hours: "", rate: "", amount: "", memo: "" };

export function ContractorsView({
  contractors,
  totals,
  timesheets,
}: {
  contractors: Contractor[];
  totals: Record<string, Totals>;
  timesheets: TimesheetRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Contractor form
  const [editing, setEditing] = useState<Contractor | null>(null);
  const [contractorOpen, setContractorOpen] = useState(false);
  const [cForm, setCForm] = useState(EMPTY_CONTRACTOR);

  // Timesheet form
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sForm, setSForm] = useState(EMPTY_SHEET);

  // Import
  const fileRef = useRef<HTMLInputElement>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  // Selection + linking
  const [filter, setFilter] = useState<"unpaid" | "paid" | "all">("unpaid");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [linkOpen, setLinkOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);

  const shown = timesheets.filter((s) => filter === "all" || s.status === filter);
  const picked = timesheets.filter((s) => selected.has(s.id));
  const owed = round2(picked.reduce((sum, s) => sum + Math.max(0, s.amount - s.paid), 0));
  const all = Object.values(totals);
  const sum = (f: (t: Totals) => number) => round2(all.reduce((a, t) => a + f(t), 0));

  function openContractor(c: Contractor | null) {
    setEditing(c);
    setCForm(
      c
        ? { name: c.name, email: c.email ?? "", platform: c.platform as "upwork" | "direct", platformRef: c.platformRef ?? "", defaultRate: String(c.defaultRate || ""), status: c.status as "active" | "inactive" }
        : EMPTY_CONTRACTOR,
    );
    setError(null);
    setContractorOpen(true);
  }
  function saveContractor() {
    start(async () => {
      const r = await saveContractorAction({
        ...(editing ? { id: editing.id } : {}),
        ...cForm,
        defaultRate: Number(cForm.defaultRate) || 0,
      });
      if (r?.error) return setError(r.error);
      setContractorOpen(false);
      router.refresh();
    });
  }

  function openSheet() {
    setSForm({ ...EMPTY_SHEET, contractorId: contractors[0]?.id ?? "" });
    setError(null);
    setSheetOpen(true);
  }
  const sheetRate = sForm.rate || String(contractors.find((c) => c.id === sForm.contractorId)?.defaultRate ?? "");
  const sheetDefaultAmount = round2((Number(sForm.hours) || 0) * (Number(sheetRate) || 0));
  function saveSheet() {
    start(async () => {
      const r = await saveTimesheetAction({
        contractorId: sForm.contractorId,
        periodStart: sForm.periodStart || null,
        periodEnd: sForm.periodEnd,
        hours: Number(sForm.hours) || 0,
        ...(sForm.rate ? { rate: Number(sForm.rate) } : {}),
        ...(sForm.amount ? { amount: Number(sForm.amount) } : {}),
        memo: sForm.memo,
      });
      if (r?.error) return setError(r.error);
      setSheetOpen(false);
      router.refresh();
    });
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    setSummary(await importUpworkCsvAction(fd));
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function openLink() {
    setSuggestions(null);
    setError(null);
    setLinkOpen(true);
    start(async () => setSuggestions(await suggestTimesheetPaymentsAction([...selected])));
  }
  function link(txId: string) {
    start(async () => {
      await linkTimesheetPaymentAction(txId, [...selected]);
      setLinkOpen(false);
      setSelected(new Set());
      router.refresh();
    });
  }
  function unlink(timesheetId: string, txId: string) {
    start(async () => {
      await unlinkTimesheetPaymentAction(timesheetId, txId);
      router.refresh();
    });
  }
  function remove(id: string) {
    if (!confirm("Delete this timesheet?")) return;
    start(async () => {
      await deleteTimesheetAction(id);
      router.refresh();
    });
  }

  return (
    <div>
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Billed" value={money(sum((t) => t.billed))} sub={`${sum((t) => t.hours)} hours · ${timesheets.length} timesheets`} />
        <StatCard label="Paid" value={money(sum((t) => t.paid))} sub="linked to a bank payment" tone="brand" />
        <StatCard label="Unpaid" value={money(sum((t) => t.unpaid))} sub="no bank payment linked yet" tone="out" />
      </div>

      <Card className="mb-4 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold">Contractors</h2>
          <button className="btn-outline" onClick={() => openContractor(null)}>
            <IconPlus className="h-4 w-4" /> New contractor
          </button>
        </div>
        {contractors.length === 0 ? (
          <EmptyState title="No contractors yet" hint="Add one, or import an Upwork transaction history CSV below — contractors are created from it." />
        ) : (
          <table className="w-full">
            <thead className="border-b border-line bg-paper/60">
              <tr>
                <th className="th">Name</th>
                <th className="th">Platform</th>
                <th className="th text-right">Rate</th>
                <th className="th text-right">Hours</th>
                <th className="th text-right">Billed</th>
                <th className="th text-right">Paid</th>
                <th className="th text-right">Unpaid</th>
                <th className="th w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {contractors.map((c) => {
                const t = totals[c.id] ?? { hours: 0, billed: 0, paid: 0, unpaid: 0, count: 0 };
                return (
                  <tr key={c.id} className={`hover:bg-paper/50 ${c.status === "inactive" ? "opacity-60" : ""}`}>
                    <td className="td font-medium">{c.name}</td>
                    <td className="td text-ink-soft capitalize">{c.platform}</td>
                    <td className="td text-right tabular">{c.defaultRate ? `${moneyIn(c.defaultRate, c.currency)}/h` : "—"}</td>
                    <td className="td text-right tabular">{t.hours}</td>
                    <td className="td text-right tabular">{moneyIn(t.billed, c.currency)}</td>
                    <td className="td text-right tabular">{moneyIn(t.paid, c.currency)}</td>
                    <td className={`td text-right tabular ${t.unpaid > 0 ? "font-medium text-money-out" : ""}`}>{moneyIn(t.unpaid, c.currency)}</td>
                    <td className="td">
                      <button className="btn-ghost px-2 py-1" title="Edit" onClick={() => openContractor(c)}>
                        <IconEdit className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold">Timesheets</h2>
            <div className="flex rounded-lg border border-line text-sm">
              {(["unpaid", "paid", "all"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 capitalize ${filter === f ? "bg-brand-wash text-brand-dark" : "text-ink-soft"}`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <button className="btn-primary" onClick={openLink}>
                Link {selected.size} to payment · {money(owed)}
              </button>
            )}
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
            <button className="btn-outline" onClick={() => fileRef.current?.click()}>
              <IconUpload className="h-4 w-4" /> Import Upwork CSV
            </button>
            <button className="btn-outline" onClick={openSheet} disabled={contractors.length === 0}>
              <IconPlus className="h-4 w-4" /> Add timesheet
            </button>
          </div>
        </div>
        {summary && (
          <div className="border-b border-line bg-paper px-5 py-3 text-sm">
            <span className="mr-6"><strong className="text-brand">{summary.imported}</strong> timesheet(s) imported</span>
            {summary.contractorsCreated > 0 && <span className="mr-6">{summary.contractorsCreated} new contractor(s)</span>}
            {summary.duplicates > 0 && <span className="mr-6 text-ink-faint">{summary.duplicates} already imported</span>}
            <span className="text-ink-faint">{summary.skipped} fee / payment row(s) skipped</span>
            {summary.errors.map((e) => <div key={e} className="mt-1 text-money-out">{e}</div>)}
          </div>
        )}
        {shown.length === 0 ? (
          <EmptyState title={filter === "all" ? "No timesheets yet" : `No ${filter} timesheets`} hint="Import an Upwork transaction history CSV, or add one by hand." />
        ) : (
          <table className="w-full">
            <thead className="border-b border-line bg-paper/60">
              <tr>
                <th className="th w-8"></th>
                <th className="th">Contractor</th>
                <th className="th">Period</th>
                <th className="th text-right">Hours</th>
                <th className="th text-right">Rate</th>
                <th className="th text-right">Amount</th>
                <th className="th">Status</th>
                <th className="th">Paid by</th>
                <th className="th w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((s) => (
                <tr key={s.id} className="hover:bg-paper/50">
                  <td className="td">
                    {s.status === "unpaid" && (
                      <input type="checkbox" aria-label={`Select ${s.contractorName} ${s.periodEnd}`} checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                    )}
                  </td>
                  <td className="td">
                    <div className="font-medium">{s.contractorName}</div>
                    {s.memo && <div className="max-w-xs truncate text-xs text-ink-faint" title={s.memo}>{s.memo}</div>}
                  </td>
                  <td className="td whitespace-nowrap text-ink-soft">
                    {s.periodStart ? `${fmtDate(s.periodStart)} – ` : ""}{fmtDate(s.periodEnd)}
                  </td>
                  <td className="td text-right tabular">{s.hours || "—"}</td>
                  <td className="td text-right tabular">{s.rate ? moneyIn(s.rate, s.currency) : "—"}</td>
                  <td className="td text-right tabular font-medium">{moneyIn(s.amount, s.currency)}</td>
                  <td className="td"><StatusBadge status={s.status} /></td>
                  <td className="td text-xs text-ink-soft">
                    {s.paidBy.map((p) => (
                      <div key={p.transactionId} className="flex items-center gap-1 whitespace-nowrap">
                        {fmtDate(p.bookedDate)} · {p.description}
                        <button className="text-ink-faint hover:text-money-out" title="Unlink" onClick={() => unlink(s.id, p.transactionId)}>✕</button>
                      </div>
                    ))}
                  </td>
                  <td className="td">
                    <button className="btn-ghost px-2 py-1" title="Delete" onClick={() => remove(s.id)}>
                      <IconTrash className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal
        open={contractorOpen}
        onClose={() => setContractorOpen(false)}
        title={editing ? "Edit contractor" : "New contractor"}
        footer={<button className="btn-primary" disabled={pending || !cForm.name.trim()} onClick={saveContractor}>Save</button>}
      >
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2"><span className="label">Name</span><input className="input" value={cForm.name} onChange={(e) => setCForm({ ...cForm, name: e.target.value })} /></label>
          <label><span className="label">Platform</span>
            <select className="input" value={cForm.platform} onChange={(e) => setCForm({ ...cForm, platform: e.target.value as "upwork" | "direct" })}>
              <option value="upwork">Upwork</option>
              <option value="direct">Direct</option>
            </select>
          </label>
          <label><span className="label">Default hourly rate</span><input type="number" step="0.01" className="input tabular" value={cForm.defaultRate} onChange={(e) => setCForm({ ...cForm, defaultRate: e.target.value })} /></label>
          <label><span className="label">Email</span><input className="input" value={cForm.email} onChange={(e) => setCForm({ ...cForm, email: e.target.value })} /></label>
          <label><span className="label">Name on the platform</span><input className="input" value={cForm.platformRef} onChange={(e) => setCForm({ ...cForm, platformRef: e.target.value })} placeholder="as it appears in the Upwork CSV" /></label>
          {editing && (
            <label><span className="label">Status</span>
              <select className="input" value={cForm.status} onChange={(e) => setCForm({ ...cForm, status: e.target.value as "active" | "inactive" })}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-money-out">{error}</p>}
      </Modal>

      <Modal
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Add timesheet"
        footer={<button className="btn-primary" disabled={pending || !sForm.contractorId || !sForm.periodEnd} onClick={saveSheet}>Save</button>}
      >
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2"><span className="label">Contractor</span>
            <select className="input" value={sForm.contractorId} onChange={(e) => setSForm({ ...sForm, contractorId: e.target.value })}>
              {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label><span className="label">Period start</span><input type="date" className="input" value={sForm.periodStart} onChange={(e) => setSForm({ ...sForm, periodStart: e.target.value })} /></label>
          <label><span className="label">Period end</span><input type="date" className="input" value={sForm.periodEnd} onChange={(e) => setSForm({ ...sForm, periodEnd: e.target.value })} /></label>
          <label><span className="label">Hours</span><input type="number" step="0.25" className="input tabular" value={sForm.hours} onChange={(e) => setSForm({ ...sForm, hours: e.target.value })} /></label>
          <label><span className="label">Rate</span><input type="number" step="0.01" className="input tabular" value={sForm.rate} placeholder={sheetRate} onChange={(e) => setSForm({ ...sForm, rate: e.target.value })} /></label>
          <label className="col-span-2"><span className="label">Amount</span><input type="number" step="0.01" className="input tabular" value={sForm.amount} placeholder={String(sheetDefaultAmount)} onChange={(e) => setSForm({ ...sForm, amount: e.target.value })} /><span className="mt-1 block text-xs text-ink-faint">Leave blank for hours × rate. Set it for fixed-price work.</span></label>
          <label className="col-span-2"><span className="label">Memo</span><input className="input" value={sForm.memo} onChange={(e) => setSForm({ ...sForm, memo: e.target.value })} /></label>
        </div>
        {error && <p className="mt-3 text-sm text-money-out">{error}</p>}
      </Modal>

      <Modal open={linkOpen} onClose={() => setLinkOpen(false)} title={`Link ${selected.size} timesheet(s) to a payment`} wide>
        <p className="mb-3 text-sm text-ink-soft">
          Still owed on these: <strong className="tabular">{money(owed)}</strong>. Bank payments mentioning Upwork within a week of the period end, big enough to cover it:
        </p>
        {suggestions === null ? (
          <p className="text-sm text-ink-faint">Looking…</p>
        ) : suggestions.length === 0 ? (
          <p className="text-sm text-ink-faint">No matching Upwork payment found. Import the bank statement that covers it first.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line">
              <tr>
                <th className="th">Date</th>
                <th className="th">Description</th>
                <th className="th text-right">Paid</th>
                <th className="th text-right">Upwork fee</th>
                <th className="th w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {suggestions.map((t) => (
                <tr key={t.id}>
                  <td className="td whitespace-nowrap">{fmtDate(t.bookedDate)}</td>
                  <td className="td">{t.description}</td>
                  <td className="td text-right tabular">{moneyIn(Math.abs(t.amount), t.currency)}</td>
                  <td className="td text-right tabular text-ink-soft">{t.fee === null ? "different currency" : money(t.fee)}</td>
                  <td className="td text-right"><button className="btn-primary px-3 py-1" disabled={pending} onClick={() => link(t.id)}>Link</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>
    </div>
  );
}
