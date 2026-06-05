"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Customer, Product, VatRate, RecurringInvoiceLine } from "@/db/schema";
import { money, round2, todayISO } from "@/lib/format";
import { Card } from "@/components/ui";
import { IconPlus, IconTrash } from "@/components/icons";
import { saveRecurringAction } from "@/app/actions";

type EditorLine = {
  key: string;
  productId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  vatRateId: string | null;
};

type ExistingRecurring = {
  id: string;
  name: string;
  customerId: string;
  frequency: string;
  interval: number;
  startDate: string;
  endDate: string | null;
  occurrencesLimit: number | null;
  dueDays: number;
  autoSend: boolean;
  notes: string | null;
  terms: string | null;
  lines: RecurringInvoiceLine[];
};

type Props = {
  customers: Customer[];
  products: Product[];
  vatRates: VatRate[];
  recurring?: ExistingRecurring;
};

let keyc = 0;
const nk = () => `r${keyc++}`;

export function RecurringEditor({ customers, products, vatRates, recurring }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const vatMap = useMemo(() => new Map(vatRates.map((v) => [v.id, v])), [vatRates]);
  const defaultVat = vatRates.find((v) => v.isDefault)?.id ?? null;

  const [name, setName] = useState(recurring?.name ?? "");
  const [customerId, setCustomerId] = useState(recurring?.customerId ?? "");
  const [frequency, setFrequency] = useState(recurring?.frequency ?? "monthly");
  const [interval, setInterval] = useState(String(recurring?.interval ?? 1));
  const [startDate, setStartDate] = useState(recurring?.startDate ?? todayISO());
  const [endMode, setEndMode] = useState<"never" | "date" | "count">(
    recurring?.endDate ? "date" : recurring?.occurrencesLimit ? "count" : "never",
  );
  const [endDate, setEndDate] = useState(recurring?.endDate ?? "");
  const [occurrences, setOccurrences] = useState(String(recurring?.occurrencesLimit ?? 12));
  const [dueDays, setDueDays] = useState(String(recurring?.dueDays ?? 30));
  const [autoSend, setAutoSend] = useState(recurring?.autoSend ?? false);
  const [notes, setNotes] = useState(recurring?.notes ?? "");
  const [terms, setTerms] = useState(recurring?.terms ?? "");
  const [error, setError] = useState("");
  const [lines, setLines] = useState<EditorLine[]>(
    recurring
      ? recurring.lines.map((l) => ({
          key: nk(),
          productId: l.productId,
          description: l.description,
          quantity: String(l.quantity),
          unitPrice: String(l.unitPrice),
          vatRateId: l.vatRateId,
        }))
      : [{ key: nk(), productId: null, description: "", quantity: "1", unitPrice: "0", vatRateId: defaultVat }],
  );

  function updateLine(key: string, patch: Partial<EditorLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((ls) => [...ls, { key: nk(), productId: null, description: "", quantity: "1", unitPrice: "0", vatRateId: defaultVat }]);
  }
  function removeLine(key: string) {
    setLines((ls) => (ls.length === 1 ? ls : ls.filter((l) => l.key !== key)));
  }
  function pickProduct(key: string, productId: string) {
    const p = products.find((x) => x.id === productId);
    if (!p) return updateLine(key, { productId: null });
    updateLine(key, {
      productId: p.id,
      description: p.description?.trim() ? p.description : p.name,
      unitPrice: String(p.unitPrice),
      vatRateId: p.vatRateId,
    });
  }

  const totals = useMemo(() => {
    let net = 0, vat = 0;
    for (const l of lines) {
      const q = Number(l.quantity) || 0;
      const up = Number(l.unitPrice) || 0;
      const rate = l.vatRateId ? vatMap.get(l.vatRateId)?.rate ?? 0 : 0;
      const ln = round2(q * up);
      net += ln;
      vat += round2(ln * rate);
    }
    return { net: round2(net), vat: round2(vat), total: round2(net + vat) };
  }, [lines, vatMap]);

  function save() {
    if (!customerId) return setError("Choose a customer.");
    const payloadLines = lines
      .filter((l) => l.description.trim() || Number(l.unitPrice))
      .map((l) => ({
        productId: l.productId,
        description: l.description,
        quantity: Number(l.quantity) || 0,
        unitPrice: Number(l.unitPrice) || 0,
        vatRateId: l.vatRateId,
      }));
    if (payloadLines.length === 0) return setError("Add at least one line item.");
    startTransition(async () => {
      await saveRecurringAction({
        id: recurring?.id,
        name,
        customerId,
        frequency: frequency as "weekly" | "monthly" | "quarterly" | "yearly",
        interval: Number(interval) || 1,
        startDate,
        endDate: endMode === "date" ? endDate || null : null,
        occurrencesLimit: endMode === "count" ? Number(occurrences) || null : null,
        dueDays: Number(dueDays) || 0,
        autoSend,
        notes,
        terms,
        lines: payloadLines,
      });
      router.push("/invoices");
    });
  }

  const freqWord =
    frequency === "weekly" ? "week(s)" : frequency === "monthly" ? "month(s)" : frequency === "quarterly" ? "quarter(s)" : "year(s)";

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        <Card className="p-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Schedule name (optional)</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Monthly retainer — Acme" />
            </div>
            <div className="col-span-2">
              <label className="label">Customer</label>
              <select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Select customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>
        </Card>

        <Card className="p-5 space-y-4">
          <div className="text-sm font-semibold">Schedule</div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Repeat every</label>
              <input type="number" min="1" className="input tabular w-24" value={interval} onChange={(e) => setInterval(e.target.value)} />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="label">&nbsp;</label>
              <select className="input" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                <option value="weekly">week(s)</option>
                <option value="monthly">month(s)</option>
                <option value="quarterly">quarter(s)</option>
                <option value="yearly">year(s)</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">First invoice date</label>
              <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="label">Payment terms (days)</label>
              <input type="number" className="input tabular" value={dueDays} onChange={(e) => setDueDays(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Ends</label>
            <div className="flex flex-wrap items-center gap-3">
              <select className="input w-40" value={endMode} onChange={(e) => setEndMode(e.target.value as typeof endMode)}>
                <option value="never">Never</option>
                <option value="date">On date</option>
                <option value="count">After N invoices</option>
              </select>
              {endMode === "date" && (
                <input type="date" className="input w-44" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              )}
              {endMode === "count" && (
                <input type="number" className="input tabular w-28" value={occurrences} onChange={(e) => setOccurrences(e.target.value)} />
              )}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-brand" checked={autoSend} onChange={(e) => setAutoSend(e.target.checked)} />
            Automatically mark generated invoices as “sent” (otherwise they're created as drafts for review)
          </label>
        </Card>

        <Card className="overflow-hidden">
          <table className="w-full">
            <thead className="border-b border-line bg-paper/60">
              <tr>
                <th className="th">Item / description</th>
                <th className="th w-20 text-right">Qty</th>
                <th className="th w-28 text-right">Unit price</th>
                <th className="th w-32">VAT</th>
                <th className="th w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {lines.map((l) => (
                <tr key={l.key} className="align-top">
                  <td className="td">
                    <select className="input mb-1.5 py-1.5 text-xs" value={l.productId ?? ""} onChange={(e) => pickProduct(l.key, e.target.value)}>
                      <option value="">— Custom line —</option>
                      {products.filter((p) => !p.archived).map((p) => (
                        <option key={p.id} value={p.id}>{p.name} ({money(p.unitPrice)})</option>
                      ))}
                    </select>
                    <textarea className="input min-h-[38px] py-1.5" placeholder="Description" value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} />
                  </td>
                  <td className="td"><input type="number" step="0.01" className="input tabular text-right py-1.5" value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} /></td>
                  <td className="td"><input type="number" step="0.01" className="input tabular text-right py-1.5" value={l.unitPrice} onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })} /></td>
                  <td className="td">
                    <select className="input py-1.5" value={l.vatRateId ?? ""} onChange={(e) => updateLine(l.key, { vatRateId: e.target.value || null })}>
                      <option value="">No VAT</option>
                      {vatRates.map((v) => (<option key={v.id} value={v.id}>{v.name}</option>))}
                    </select>
                  </td>
                  <td className="td pt-3">
                    <button className="text-ink-faint hover:text-money-out" onClick={() => removeLine(l.key)}><IconTrash className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="p-3">
            <button className="btn-outline" onClick={addLine}><IconPlus className="h-4 w-4" /> Add line</button>
          </div>
        </Card>

        <Card className="p-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Notes (on each invoice)</label>
              <textarea className="input min-h-[60px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div>
              <label className="label">Payment terms text</label>
              <textarea className="input min-h-[60px]" value={terms} onChange={(e) => setTerms(e.target.value)} />
            </div>
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <Card className="sticky top-6 p-5">
          <div className="mb-2 text-sm text-ink-faint">Each invoice</div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-ink-faint">Subtotal</span><span className="tabular font-medium">{money(totals.net)}</span></div>
            <div className="flex justify-between"><span className="text-ink-faint">VAT</span><span className="tabular font-medium">{money(totals.vat)}</span></div>
            <div className="flex justify-between border-t border-line pt-2 text-base"><span className="font-semibold">Total</span><span className="tabular font-bold text-brand">{money(totals.total)}</span></div>
          </div>
          <p className="mt-3 text-xs text-ink-faint">
            Repeats every {interval} {freqWord}, starting {startDate}.
          </p>
          {error && <div className="mt-3 rounded-lg bg-money-out/10 px-3 py-2 text-sm text-money-out">{error}</div>}
          <button className="btn-primary mt-4 w-full" onClick={save}>
            {recurring ? "Save schedule" : "Create schedule"}
          </button>
        </Card>
      </div>
    </div>
  );
}
