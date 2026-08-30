"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Vendor } from "@cashish/core/db";
import { money, fmtDate } from "@/lib/format";
import { Card, EmptyState, StatusBadge } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { IconPlus, IconEdit } from "@/components/icons";

type Totals = {
  spend: number;
  txCount: number;
  last: string | null;
  billed: number;
  outstanding: number;
  billCount: number;
};

/** Mirrors the saveVendor action's input, so the prop type is the real one. */
export type VendorFormInput = {
  id?: string;
  name: string;
  email?: string;
  vatNumber?: string;
  addressLine1?: string;
  city?: string;
  country?: string;
  defaultCategoryId?: string | null;
  notes?: string;
};

type Payable = {
  id: string;
  number: string;
  issueDate: string;
  dueDate: string | null;
  outstanding: number;
  overdue: boolean;
  vendorId: string;
  vendorName: string;
};

const EMPTY = {
  name: "",
  email: "",
  vatNumber: "",
  addressLine1: "",
  city: "",
  country: "Ireland",
  defaultCategoryId: "",
  notes: "",
};

export function VendorsView({
  vendors,
  totals,
  payables,
  categories,
  saveVendor,
}: {
  vendors: Vendor[];
  totals: Record<string, Totals>;
  payables: Payable[];
  categories: { id: string; name: string; kind: string }[];
  saveVendor: (data: VendorFormInput) => Promise<{ ok?: boolean; error?: string } | void>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const expenseCats = categories.filter((c) => c.kind === "expense");
  const active = vendors.filter((v) => !v.archived);
  const totalOutstanding = payables.reduce((s, p) => s + p.outstanding, 0);
  const overdueCount = payables.filter((p) => p.overdue).length;

  function openNew() {
    setEditing(null);
    setForm(EMPTY);
    setError(null);
    setOpen(true);
  }
  function openEdit(v: Vendor) {
    setEditing(v);
    setForm({
      name: v.name,
      email: v.email ?? "",
      vatNumber: v.vatNumber ?? "",
      addressLine1: v.addressLine1 ?? "",
      city: v.city ?? "",
      country: v.country ?? "Ireland",
      defaultCategoryId: v.defaultCategoryId ?? "",
      notes: v.notes ?? "",
    });
    setError(null);
    setOpen(true);
  }
  function save() {
    if (!form.name.trim()) return;
    setError(null);
    start(async () => {
      const result = await saveVendor({
        ...(editing ? { id: editing.id } : {}),
        ...form,
        defaultCategoryId: form.defaultCategoryId || null,
      });
      if (result?.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }
  const set = <K extends keyof typeof form>(k: K, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div>
      {payables.length > 0 && (
        <Card className="mb-4 p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">Owed right now</h2>
            <span className="flex items-baseline gap-3">
              {overdueCount > 0 && (
                <span className="text-xs font-medium text-money-out">
                  {overdueCount} overdue
                </span>
              )}
              <span className="tabular font-bold text-money-out">{money(totalOutstanding)}</span>
            </span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Vendor</th>
                <th className="th">Reference</th>
                <th className="th">Dated</th>
                <th className="th">Due</th>
                <th className="th text-right">Outstanding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {payables.map((p) => (
                <tr key={p.id} className="hover:bg-paper/50">
                  <td className="td">
                    <Link href={`/vendors/${p.vendorId}`} className="text-brand hover:underline">
                      {p.vendorName}
                    </Link>
                  </td>
                  <td className="td text-ink-soft">{p.number || "—"}</td>
                  <td className="td text-ink-soft">{fmtDate(p.issueDate)}</td>
                  <td className={`td ${p.overdue ? "font-medium text-money-out" : "text-ink-soft"}`}>
                    {p.dueDate ? fmtDate(p.dueDate) : "—"}
                    {p.overdue && " · overdue"}
                  </td>
                  <td className="td text-right tabular font-medium">{money(p.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div className="mb-4 flex justify-end">
        <button className="btn-primary" onClick={openNew}>
          <IconPlus className="h-4 w-4" /> New vendor
        </button>
      </div>

      <Card className="overflow-hidden">
        {active.length === 0 ? (
          <EmptyState
            title="No vendors yet"
            hint="Add one, or attach a vendor to a payment on the Transactions screen."
            action={
              <button className="btn-primary" onClick={openNew}>
                <IconPlus className="h-4 w-4" /> New vendor
              </button>
            }
          />
        ) : (
          <table className="w-full">
            <thead className="border-b border-line bg-paper/60">
              <tr>
                <th className="th">Name</th>
                <th className="th">VAT number</th>
                <th className="th text-right">Payments</th>
                <th className="th text-right">Lifetime spend</th>
                <th className="th text-right">Bills</th>
                <th className="th text-right">Owed</th>
                <th className="th">Last paid</th>
                <th className="th w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {active.map((v) => {
                const t = totals[v.id];
                return (
                  <tr key={v.id} className="hover:bg-paper/50">
                    <td className="td font-medium">
                      <Link href={`/vendors/${v.id}`} className="text-brand hover:underline">
                        {v.name}
                      </Link>
                    </td>
                    <td className="td tabular text-ink-soft">{v.vatNumber || "—"}</td>
                    <td className="td text-right tabular text-ink-soft">{t?.txCount ?? "—"}</td>
                    <td className="td text-right tabular font-medium">
                      {t?.spend ? money(t.spend) : "—"}
                    </td>
                    <td className="td text-right tabular text-ink-soft">{t?.billCount ?? "—"}</td>
                    <td className="td text-right tabular">
                      {t && t.outstanding > 0.005 ? (
                        <span className="font-medium text-money-out">{money(t.outstanding)}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="td text-ink-soft">{t?.last ? fmtDate(t.last) : "—"}</td>
                    <td className="td text-right">
                      <button className="btn-ghost px-2 py-1" onClick={() => openEdit(v)}>
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

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit vendor" : "New vendor"}
        footer={
          <>
            <button className="btn-outline" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" disabled={pending} onClick={save}>
              {pending ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="label">Name</span>
            <input
              className="input"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="TD Synnex Ireland Limited"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">Email</span>
              <input className="input" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </label>
            <label className="block">
              <span className="label">VAT number</span>
              <input
                className="input"
                value={form.vatNumber}
                onChange={(e) => set("vatNumber", e.target.value)}
              />
            </label>
          </div>
          <label className="block">
            <span className="label">Usually books to</span>
            <select
              className="input"
              value={form.defaultCategoryId}
              onChange={(e) => set("defaultCategoryId", e.target.value)}
            >
              <option value="">No default</option>
              {expenseCats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-ink-faint">
              Used as the default category when you enter a bill from them.
            </span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">Address</span>
              <input
                className="input"
                value={form.addressLine1}
                onChange={(e) => set("addressLine1", e.target.value)}
              />
            </label>
            <label className="block">
              <span className="label">City</span>
              <input className="input" value={form.city} onChange={(e) => set("city", e.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className="label">Notes</span>
            <textarea
              className="input"
              rows={2}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-money-out">
              {error}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
