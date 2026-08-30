"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Settings, Category, VatRate } from "@/db/schema";
import { Card } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { Dot } from "@/components/ui";
import { IconPlus, IconEdit, IconCheck } from "@/components/icons";
import { saveSettings, saveCategory, deleteCategory } from "@/app/actions";

type Props = {
  settings: Settings;
  categories: Category[];
  vatRates: VatRate[];
};

export function SettingsView({ settings, categories, vatRates }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [biz, setBiz] = useState({
    businessName: settings.businessName ?? "",
    addressLine1: settings.addressLine1 ?? "",
    addressLine2: settings.addressLine2 ?? "",
    city: settings.city ?? "",
    country: settings.country ?? "Ireland",
    vatNumber: settings.vatNumber ?? "",
    employerRegNumber: settings.employerRegNumber ?? "",
    email: settings.email ?? "",
    phone: settings.phone ?? "",
    iban: settings.iban ?? "",
    bic: settings.bic ?? "",
    invoicePrefix: settings.invoicePrefix ?? "INV-",
    nextInvoiceSeq: String(settings.nextInvoiceSeq ?? 1),
    invoiceFooter: settings.invoiceFooter ?? "",
  });

  function setB<K extends keyof typeof biz>(k: K, v: string) {
    setBiz((b) => ({ ...b, [k]: v }));
  }

  function saveBiz() {
    startTransition(async () => {
      await saveSettings({
        ...biz,
        nextInvoiceSeq: Number(biz.nextInvoiceSeq) || 1,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.refresh();
    });
  }

  // category modal
  const [catOpen, setCatOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const blankCat = {
    name: "",
    kind: "expense",
    defaultVatRateId: vatRates.find((v) => v.isDefault)?.id ?? "",
    vatApplicable: true,
    color: "#9ca3af",
  };
  const [catForm, setCatForm] = useState(blankCat);

  function openNewCat() {
    setEditingCat(null);
    setCatForm(blankCat);
    setCatOpen(true);
  }
  function openEditCat(c: Category) {
    setEditingCat(c);
    setCatForm({
      name: c.name,
      kind: c.kind,
      defaultVatRateId: c.defaultVatRateId ?? "",
      vatApplicable: c.vatApplicable,
      color: c.color ?? "#9ca3af",
    });
    setCatOpen(true);
  }
  function saveCat() {
    if (!catForm.name.trim()) return;
    startTransition(async () => {
      await saveCategory({
        id: editingCat?.id,
        name: catForm.name,
        kind: catForm.kind,
        defaultVatRateId: catForm.defaultVatRateId || null,
        vatApplicable: catForm.vatApplicable,
        color: catForm.color,
      });
      setCatOpen(false);
      router.refresh();
    });
  }
  function delCat() {
    if (!editingCat) return;
    if (!confirm("Delete this category? Transactions using it become uncategorised."))
      return;
    startTransition(async () => {
      await deleteCategory(editingCat.id);
      setCatOpen(false);
      router.refresh();
    });
  }

  const income = categories.filter((c) => c.kind === "income");
  const expense = categories.filter((c) => c.kind === "expense");
  const vatMap = new Map(vatRates.map((v) => [v.id, v]));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="mb-4 font-semibold">Business details</h2>
        <div className="space-y-4">
          <div>
            <label className="label">Business name</label>
            <input
              className="input"
              value={biz.businessName}
              onChange={(e) => setB("businessName", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                value={biz.email}
                onChange={(e) => setB("email", e.target.value)}
              />
            </div>
            <div>
              <label className="label">Phone</label>
              <input
                className="input"
                value={biz.phone}
                onChange={(e) => setB("phone", e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="label">Address line 1</label>
            <input
              className="input"
              value={biz.addressLine1}
              onChange={(e) => setB("addressLine1", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Address line 2</label>
              <input
                className="input"
                value={biz.addressLine2}
                onChange={(e) => setB("addressLine2", e.target.value)}
              />
            </div>
            <div>
              <label className="label">City</label>
              <input
                className="input"
                value={biz.city}
                onChange={(e) => setB("city", e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Country</label>
              <input
                className="input"
                value={biz.country}
                onChange={(e) => setB("country", e.target.value)}
              />
            </div>
            <div>
              <label className="label">VAT number</label>
              <input
                className="input"
                value={biz.vatNumber}
                onChange={(e) => setB("vatNumber", e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="label">Employer registration number (payroll)</label>
            <input
              className="input tabular"
              value={biz.employerRegNumber}
              onChange={(e) => setB("employerRegNumber", e.target.value)}
              placeholder="1234567T"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">IBAN</label>
              <input
                className="input tabular"
                value={biz.iban}
                onChange={(e) => setB("iban", e.target.value)}
              />
            </div>
            <div>
              <label className="label">BIC</label>
              <input
                className="input tabular"
                value={biz.bic}
                onChange={(e) => setB("bic", e.target.value)}
              />
            </div>
          </div>
          <button className="btn-primary" onClick={saveBiz}>
            {saved ? (
              <>
                <IconCheck className="h-4 w-4" /> Saved
              </>
            ) : (
              "Save business details"
            )}
          </button>
        </div>
      </Card>

      <div className="space-y-4">
        <Card className="p-5">
          <h2 className="mb-4 font-semibold">Invoicing</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Number prefix</label>
              <input
                className="input tabular"
                value={biz.invoicePrefix}
                onChange={(e) => setB("invoicePrefix", e.target.value)}
              />
            </div>
            <div>
              <label className="label">Next number</label>
              <input
                className="input tabular"
                type="number"
                value={biz.nextInvoiceSeq}
                onChange={(e) => setB("nextInvoiceSeq", e.target.value)}
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-ink-faint">
            Next invoice will be{" "}
            <span className="font-mono font-semibold text-ink">
              {biz.invoicePrefix}
              {String(Number(biz.nextInvoiceSeq) || 1).padStart(4, "0")}
            </span>
          </p>
          <div className="mt-4">
            <label className="label">Invoice footer</label>
            <textarea
              className="input min-h-[60px]"
              value={biz.invoiceFooter}
              onChange={(e) => setB("invoiceFooter", e.target.value)}
            />
          </div>
          <button className="btn-primary mt-4" onClick={saveBiz}>
            Save
          </button>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Categories</h2>
            <button className="btn-outline py-1.5" onClick={openNewCat}>
              <IconPlus className="h-4 w-4" /> Add
            </button>
          </div>
          <CatGroup title="Income" cats={income} onEdit={openEditCat} vatMap={vatMap} />
          <CatGroup
            title="Expense"
            cats={expense}
            onEdit={openEditCat}
            vatMap={vatMap}
          />
        </Card>
      </div>

      <Modal
        open={catOpen}
        onClose={() => setCatOpen(false)}
        title={editingCat ? "Edit category" : "New category"}
        footer={
          <>
            {editingCat && (
              <button className="btn-danger mr-auto" onClick={delCat}>
                Delete
              </button>
            )}
            <button className="btn-outline" onClick={() => setCatOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={saveCat}>
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
              value={catForm.name}
              onChange={(e) => setCatForm((f) => ({ ...f, name: e.target.value }))}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Type</label>
              <select
                className="input"
                value={catForm.kind}
                onChange={(e) => setCatForm((f) => ({ ...f, kind: e.target.value }))}
              >
                <option value="income">Income</option>
                <option value="expense">Expense</option>
              </select>
            </div>
            <div>
              <label className="label">Colour</label>
              <input
                type="color"
                className="input h-[38px] p-1"
                value={catForm.color}
                onChange={(e) => setCatForm((f) => ({ ...f, color: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className="label">Default VAT rate</label>
            <select
              className="input"
              value={catForm.defaultVatRateId}
              onChange={(e) =>
                setCatForm((f) => ({ ...f, defaultVatRateId: e.target.value }))
              }
            >
              <option value="">None</option>
              {vatRates.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-brand"
              checked={catForm.vatApplicable}
              onChange={(e) =>
                setCatForm((f) => ({ ...f, vatApplicable: e.target.checked }))
              }
            />
            VAT applies to transactions in this category
          </label>
        </div>
      </Modal>
    </div>
  );
}

function CatGroup({
  title,
  cats,
  onEdit,
  vatMap,
}: {
  title: string;
  cats: Category[];
  onEdit: (c: Category) => void;
  vatMap: Map<string, VatRate>;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        {title}
      </div>
      <div className="space-y-1">
        {cats.map((c) => (
          <button
            key={c.id}
            onClick={() => onEdit(c)}
            className="group flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-black/[0.04]"
          >
            <span className="flex items-center gap-2">
              <Dot color={c.color ?? "#9ca3af"} />
              {c.name}
            </span>
            <span className="flex items-center gap-2 text-xs text-ink-faint">
              {c.defaultVatRateId ? vatMap.get(c.defaultVatRateId)?.name : "No VAT"}
              <IconEdit className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100" />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
