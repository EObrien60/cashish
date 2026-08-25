"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Product, VatRate, Category } from "@/db/schema";
import { money, pct } from "@/lib/format";
import { Card, EmptyState } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { IconPlus, IconEdit } from "@/components/icons";
import { saveProduct, archiveProduct } from "@/app/actions";

type Usage = { units: number; net: number; lines: number };

type Props = {
  products: Product[];
  vatRates: VatRate[];
  categories: Category[];
  /** Keyed by product id. Absent means it has never been invoiced. */
  usage?: Record<string, Usage>;
};

export function ProductsView({ products, vatRates, categories, usage = {} }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const defaultVat = vatRates.find((v) => v.isDefault)?.id ?? vatRates[0]?.id ?? "";
  const incomeCats = categories.filter((c) => c.kind === "income");

  const EMPTY = {
    name: "",
    description: "",
    unitPrice: "0",
    vatRateId: defaultVat,
    kind: "service",
    incomeCategoryId: incomeCats[0]?.id ?? "",
    sku: "",
  };
  const [form, setForm] = useState(EMPTY);

  const vatMap = new Map(vatRates.map((v) => [v.id, v]));

  function openNew() {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  }
  function openEdit(p: Product) {
    setEditing(p);
    setForm({
      name: p.name,
      description: p.description ?? "",
      unitPrice: String(p.unitPrice),
      vatRateId: p.vatRateId ?? "",
      kind: p.kind,
      incomeCategoryId: p.incomeCategoryId ?? "",
      sku: p.sku ?? "",
    });
    setOpen(true);
  }
  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  function save() {
    if (!form.name.trim()) return;
    startTransition(async () => {
      await saveProduct({
        id: editing?.id,
        name: form.name,
        description: form.description,
        unitPrice: Number(form.unitPrice) || 0,
        vatRateId: form.vatRateId || null,
        kind: form.kind,
        incomeCategoryId: form.incomeCategoryId || null,
        sku: form.sku,
      });
      setOpen(false);
      router.refresh();
    });
  }

  const active = products.filter((p) => !p.archived);

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button className="btn-primary" onClick={openNew}>
          <IconPlus className="h-4 w-4" /> New product / service
        </button>
      </div>

      <Card className="overflow-hidden">
        {active.length === 0 ? (
          <EmptyState
            title="Your product library is empty"
            hint="Add the products and services you sell. They'll be one-click on invoices."
            action={
              <button className="btn-primary" onClick={openNew}>
                <IconPlus className="h-4 w-4" /> New product / service
              </button>
            }
          />
        ) : (
          <table className="w-full">
            <thead className="border-b border-line bg-paper/60">
              <tr>
                <th className="th">Name</th>
                <th className="th">Type</th>
                <th className="th">SKU</th>
                <th className="th text-right">Unit price (ex VAT)</th>
                <th className="th text-right">VAT</th>
                <th className="th text-right">Sold</th>
                <th className="th text-right">Net invoiced</th>
                <th className="th w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {active.map((p) => {
                const v = p.vatRateId ? vatMap.get(p.vatRateId) : null;
                return (
                  <tr key={p.id} className="hover:bg-paper/50">
                    <td className="td">
                      <Link
                        href={`/products/${p.id}`}
                        className="font-medium text-brand hover:underline"
                      >
                        {p.name}
                      </Link>
                      {p.description && (
                        <div className="text-xs text-ink-faint">
                          {p.description}
                        </div>
                      )}
                    </td>
                    <td className="td capitalize text-ink-soft">{p.kind}</td>
                    <td className="td text-ink-soft tabular">{p.sku || "—"}</td>
                    <td className="td text-right tabular font-medium">
                      {money(p.unitPrice)}
                    </td>
                    <td className="td text-right text-ink-soft">
                      {v ? (v.exempt ? "Exempt" : pct(v.rate)) : "—"}
                    </td>
                    <td className="td text-right tabular text-ink-soft">
                      {usage[p.id]?.units ?? "—"}
                    </td>
                    <td className="td text-right tabular">
                      {usage[p.id] ? money(usage[p.id].net) : "—"}
                    </td>
                    <td className="td text-right">
                      <button
                        className="btn-ghost px-2 py-1"
                        onClick={() => openEdit(p)}
                      >
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
        title={editing ? "Edit product" : "New product / service"}
        footer={
          <>
            {editing && (
              <button
                className="btn-danger mr-auto"
                onClick={() =>
                  startTransition(async () => {
                    await archiveProduct(editing.id, true);
                    setOpen(false);
                    router.refresh();
                  })
                }
              >
                Archive
              </button>
            )}
            <button className="btn-outline" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={save}>
              Save
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label">Name</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Consulting — day rate"
              autoFocus
            />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea
              className="input min-h-[60px]"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Appears as the default line description on invoices."
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Unit price (ex VAT)</label>
              <input
                className="input tabular"
                type="number"
                step="0.01"
                value={form.unitPrice}
                onChange={(e) => set("unitPrice", e.target.value)}
              />
            </div>
            <div>
              <label className="label">VAT rate</label>
              <select
                className="input"
                value={form.vatRateId}
                onChange={(e) => set("vatRateId", e.target.value)}
              >
                <option value="">No VAT</option>
                {vatRates.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Type</label>
              <select
                className="input"
                value={form.kind}
                onChange={(e) => set("kind", e.target.value)}
              >
                <option value="service">Service</option>
                <option value="good">Good</option>
              </select>
            </div>
            <div>
              <label className="label">SKU</label>
              <input
                className="input"
                value={form.sku}
                onChange={(e) => set("sku", e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="label">Income category</label>
            <select
              className="input"
              value={form.incomeCategoryId}
              onChange={(e) => set("incomeCategoryId", e.target.value)}
            >
              <option value="">None</option>
              {incomeCats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Modal>
    </div>
  );
}
