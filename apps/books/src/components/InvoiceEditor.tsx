"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Customer, Product, VatRate, InvoiceLine } from "@cashish/core/db";
import { money, round2, todayISO, addDays } from "@/lib/format";
import { Card } from "@/components/ui";
import { IconPlus, IconTrash } from "@/components/icons";
import { saveInvoice } from "@/app/actions";

type EditorLine = {
  key: string;
  productId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  vatRateId: string | null;
};

type ExistingInvoice = {
  id: string;
  number: string;
  customerId: string;
  status: string;
  issueDate: string;
  dueDate: string | null;
  notes: string | null;
  terms: string | null;
  lines: InvoiceLine[];
};

type Props = {
  customers: Customer[];
  products: Product[];
  vatRates: VatRate[];
  invoice?: ExistingInvoice;
  previewNumber?: string;
};

let keyc = 0;
const nk = () => `l${keyc++}`;

export function InvoiceEditor({
  customers,
  products,
  vatRates,
  invoice,
  previewNumber,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const vatMap = useMemo(() => new Map(vatRates.map((v) => [v.id, v])), [vatRates]);

  const [customerId, setCustomerId] = useState(invoice?.customerId ?? "");
  const [status, setStatus] = useState(invoice?.status ?? "draft");
  const [issueDate, setIssueDate] = useState(invoice?.issueDate ?? todayISO());
  const [dueDate, setDueDate] = useState(
    invoice?.dueDate ?? addDays(todayISO(), 30),
  );
  const [notes, setNotes] = useState(invoice?.notes ?? "");
  const [terms, setTerms] = useState(invoice?.terms ?? "");
  const [lines, setLines] = useState<EditorLine[]>(
    invoice
      ? invoice.lines.map((l) => ({
          key: nk(),
          productId: l.productId,
          description: l.description,
          quantity: String(l.quantity),
          unitPrice: String(l.unitPrice),
          vatRateId: l.vatRateId,
        }))
      : [
          {
            key: nk(),
            productId: null,
            description: "",
            quantity: "1",
            unitPrice: "0",
            vatRateId: vatRates.find((v) => v.isDefault)?.id ?? null,
          },
        ],
  );
  const [error, setError] = useState("");

  function updateLine(key: string, patch: Partial<EditorLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((ls) => [
      ...ls,
      {
        key: nk(),
        productId: null,
        description: "",
        quantity: "1",
        unitPrice: "0",
        vatRateId: vatRates.find((v) => v.isDefault)?.id ?? null,
      },
    ]);
  }
  function removeLine(key: string) {
    setLines((ls) => (ls.length === 1 ? ls : ls.filter((l) => l.key !== key)));
  }
  function pickProduct(key: string, productId: string) {
    const p = products.find((x) => x.id === productId);
    if (!p) {
      updateLine(key, { productId: null });
      return;
    }
    updateLine(key, {
      productId: p.id,
      description: p.description?.trim() ? p.description : p.name,
      unitPrice: String(p.unitPrice),
      vatRateId: p.vatRateId,
    });
  }

  const totals = useMemo(() => {
    let net = 0;
    let vat = 0;
    const computed = lines.map((l) => {
      const q = Number(l.quantity) || 0;
      const up = Number(l.unitPrice) || 0;
      const rate = l.vatRateId ? (vatMap.get(l.vatRateId)?.rate ?? 0) : 0;
      const ln = round2(q * up);
      const lv = round2(ln * rate);
      net += ln;
      vat += lv;
      return { ...l, net: ln, vat: lv, total: round2(ln + lv) };
    });
    return {
      computed,
      net: round2(net),
      vat: round2(vat),
      total: round2(net + vat),
    };
  }, [lines, vatMap]);

  function save(targetStatus?: string) {
    if (!customerId) {
      setError("Choose a customer first.");
      return;
    }
    const payloadLines = lines
      .filter((l) => l.description.trim() || Number(l.unitPrice))
      .map((l) => ({
        productId: l.productId,
        description: l.description,
        quantity: Number(l.quantity) || 0,
        unitPrice: Number(l.unitPrice) || 0,
        vatRateId: l.vatRateId,
      }));
    if (payloadLines.length === 0) {
      setError("Add at least one line item.");
      return;
    }
    startTransition(async () => {
      const result = await saveInvoice({
        id: invoice?.id,
        customerId,
        status: targetStatus ?? status,
        issueDate,
        dueDate,
        notes,
        terms,
        lines: payloadLines,
      });
      if (result?.id) router.push(`/invoices/${result.id}`);
      else router.push("/invoices");
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        <Card className="p-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Customer</label>
              <select
                className="input"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">Select customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Issue date</label>
              <input
                type="date"
                className="input"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Due date</label>
              <input
                type="date"
                className="input"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <table className="w-full">
            <thead className="border-b border-line bg-paper/60">
              <tr>
                <th className="th">Item / description</th>
                <th className="th w-20 text-right">Qty</th>
                <th className="th w-28 text-right">Unit price</th>
                <th className="th w-32">VAT</th>
                <th className="th w-28 text-right">Amount</th>
                <th className="th w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {totals.computed.map((l) => (
                <tr key={l.key} className="align-top">
                  <td className="td">
                    <select
                      className="input mb-1.5 py-1.5 text-xs"
                      value={l.productId ?? ""}
                      onChange={(e) => pickProduct(l.key, e.target.value)}
                    >
                      <option value="">— Custom line —</option>
                      {products
                        .filter((p) => !p.archived)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({money(p.unitPrice)})
                          </option>
                        ))}
                    </select>
                    <textarea
                      className="input min-h-[38px] py-1.5"
                      placeholder="Description"
                      value={l.description}
                      onChange={(e) =>
                        updateLine(l.key, { description: e.target.value })
                      }
                    />
                  </td>
                  <td className="td">
                    <input
                      type="number"
                      step="0.01"
                      className="input tabular text-right py-1.5"
                      value={l.quantity}
                      onChange={(e) =>
                        updateLine(l.key, { quantity: e.target.value })
                      }
                    />
                  </td>
                  <td className="td">
                    <input
                      type="number"
                      step="0.01"
                      className="input tabular text-right py-1.5"
                      value={l.unitPrice}
                      onChange={(e) =>
                        updateLine(l.key, { unitPrice: e.target.value })
                      }
                    />
                  </td>
                  <td className="td">
                    <select
                      className="input py-1.5"
                      value={l.vatRateId ?? ""}
                      onChange={(e) =>
                        updateLine(l.key, { vatRateId: e.target.value || null })
                      }
                    >
                      <option value="">No VAT</option>
                      {vatRates.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="td text-right tabular font-medium pt-3">
                    {money(l.total)}
                  </td>
                  <td className="td pt-3">
                    <button
                      className="text-ink-faint hover:text-money-out"
                      onClick={() => removeLine(l.key)}
                      aria-label="Remove line"
                    >
                      <IconTrash className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="p-3">
            <button className="btn-outline" onClick={addLine}>
              <IconPlus className="h-4 w-4" /> Add line
            </button>
          </div>
        </Card>

        <Card className="p-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Notes (shown on invoice)</label>
              <textarea
                className="input min-h-[70px]"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Payment terms</label>
              <textarea
                className="input min-h-[70px]"
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                placeholder="e.g. Bank transfer within 30 days."
              />
            </div>
          </div>
        </Card>
      </div>

      {/* Summary rail */}
      <div className="space-y-4">
        <Card className="sticky top-6 p-5">
          <div className="mb-3 text-sm text-ink-faint">
            Invoice{" "}
            <span className="font-semibold text-ink">
              {invoice?.number ?? previewNumber ?? "draft"}
            </span>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-ink-faint">Subtotal</span>
              <span className="tabular font-medium">{money(totals.net)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-faint">VAT</span>
              <span className="tabular font-medium">{money(totals.vat)}</span>
            </div>
            <div className="flex justify-between border-t border-line pt-2 text-base">
              <span className="font-semibold">Total</span>
              <span className="tabular font-bold text-brand">
                {money(totals.total)}
              </span>
            </div>
          </div>

          {error && (
            <div className="mt-3 rounded-lg bg-money-out/10 px-3 py-2 text-sm text-money-out">
              {error}
            </div>
          )}

          <div className="mt-4 space-y-2">
            <button
              className="btn-primary w-full"
              onClick={() => save(status === "draft" ? "sent" : undefined)}
            >
              {invoice ? "Save invoice" : "Create & mark sent"}
            </button>
            <button className="btn-outline w-full" onClick={() => save("draft")}>
              Save as draft
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}
