"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { money, fmtDate } from "@/lib/format";
import { Card, EmptyState, StatusBadge } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { IconPlus } from "@/components/icons";

type Bill = {
  id: string;
  number: string;
  issueDate: string;
  dueDate: string | null;
  status: string;
  net: number;
  vatTotal: number;
  total: number;
  amountPaid: number;
  outstanding: number;
  overdue: boolean;
  categoryName: string | null;
  fileName: string;
  notes: string;
};

type Tx = {
  id: string;
  date: string;
  amount: number;
  description: string;
  reference: string;
  excluded: boolean;
  billLinked: boolean;
};

const today = () => new Date().toISOString().slice(0, 10);

export function VendorDetailView({
  vendor,
  bills,
  transactions,
  byYear,
  categories,
  vatRates,
  defaultCategoryId,
  createBill,
  postBill,
  setBillStatus,
  deleteBill,
  setTxVendor,
}: {
  vendor: { id: string; name: string };
  bills: Bill[];
  transactions: Tx[];
  byYear: { year: string; spend: number; count: number }[];
  categories: { id: string; name: string }[];
  vatRates: { id: string; name: string; rate: number }[];
  defaultCategoryId: string | null;
  createBill: (formData: FormData) => Promise<{ ok?: boolean; id?: string; error?: string }>;
  postBill: (billId: string, transactionId: string) => Promise<{ ok?: boolean; error?: string }>;
  setBillStatus: (id: string, status: "awaiting" | "void") => Promise<void>;
  deleteBill: (id: string, vendorId: string) => Promise<void>;
  setTxVendor: (ids: string[], vendorId: string | null) => Promise<{ updated: number }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [net, setNet] = useState("");
  const [vatRateId, setVatRateId] = useState(vatRates.find((v) => v.rate === 0.23)?.id ?? "");
  const [vatTotal, setVatTotal] = useState("");
  const [vatTouched, setVatTouched] = useState(false);
  const [payFrom, setPayFrom] = useState("");

  /** Bank lines that could pay a bill: money out, not already posted. */
  const postable = useMemo(
    () => transactions.filter((t) => t.amount < 0 && !t.excluded && !t.billLinked),
    [transactions],
  );

  // VAT follows the chosen rate until it is typed over, so the common case is
  // one field and the awkward case is still possible.
  const rate = vatRates.find((v) => v.id === vatRateId)?.rate ?? 0;
  const suggestedVat = net ? Math.round(Number(net) * rate * 100) / 100 : 0;
  const vatValue = vatTouched ? vatTotal : suggestedVat ? String(suggestedVat) : "";
  const grossPreview =
    (Number(net) || 0) + (Number(vatValue) || 0) > 0
      ? money((Number(net) || 0) + (Number(vatValue) || 0))
      : null;

  function submitBill(formData: FormData) {
    setError(null);
    formData.set("vendorId", vendor.id);
    formData.set("vatTotal", vatValue || "0");
    start(async () => {
      const result = await createBill(formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setAddOpen(false);
      setNet("");
      setVatTotal("");
      setVatTouched(false);
      setPayFrom("");
      router.refresh();
    });
  }

  const act = (fn: () => Promise<unknown>) =>
    start(async () => {
      setError(null);
      const r = (await fn()) as { error?: string } | undefined;
      if (r?.error) setError(r.error);
      router.refresh();
    });

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="rounded-lg bg-money-out/10 px-3 py-2 text-sm text-money-out">
          {error}
        </p>
      )}

      {byYear.length > 1 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-paper/60">
              <tr>
                <th className="th">Year</th>
                <th className="th text-right">Payments</th>
                <th className="th text-right">Spend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {byYear.map((y) => (
                <tr key={y.year} className="hover:bg-paper/50">
                  <td className="td font-medium">{y.year}</td>
                  <td className="td text-right tabular text-ink-soft">{y.count}</td>
                  <td className="td text-right tabular">{money(y.spend)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* ---- bills ---- */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Bills</h2>
          <button className="btn-primary" onClick={() => { setError(null); setAddOpen(true); }}>
            <IconPlus className="h-4 w-4" /> Add a bill
          </button>
        </div>
        <Card className="overflow-hidden">
          {bills.length === 0 ? (
            <EmptyState
              title="No bills on file"
              hint="Upload one you have been sent, or post one against a payment you already made."
            />
          ) : (
            <table className="w-full">
              <thead className="border-b border-line bg-paper/60">
                <tr>
                  <th className="th">Reference</th>
                  <th className="th">Dated</th>
                  <th className="th">Due</th>
                  <th className="th">Books to</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Net</th>
                  <th className="th text-right">VAT</th>
                  <th className="th text-right">Total</th>
                  <th className="th text-right">Owed</th>
                  <th className="th w-40"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {bills.map((b) => (
                  <tr key={b.id} className="hover:bg-paper/50">
                    <td className="td font-medium">
                      {b.number || <span className="text-ink-faint">no reference</span>}
                      {b.fileName && (
                        <a
                          href={`/api/bills/${b.id}/file`}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-2 text-xs text-brand hover:underline"
                        >
                          document
                        </a>
                      )}
                    </td>
                    <td className="td text-ink-soft">{fmtDate(b.issueDate)}</td>
                    <td className={`td ${b.overdue ? "font-medium text-money-out" : "text-ink-soft"}`}>
                      {b.dueDate ? fmtDate(b.dueDate) : "—"}
                    </td>
                    <td className="td text-ink-soft">{b.categoryName ?? "—"}</td>
                    <td className="td">
                      <StatusBadge status={b.overdue ? "overdue" : b.status} />
                    </td>
                    <td className="td text-right tabular">{money(b.net)}</td>
                    <td className="td text-right tabular text-ink-soft">{money(b.vatTotal)}</td>
                    <td className="td text-right tabular font-medium">{money(b.total)}</td>
                    <td className="td text-right tabular">
                      {b.outstanding > 0.005 ? money(b.outstanding) : "—"}
                    </td>
                    <td className="td text-right">
                      <div className="flex items-center justify-end gap-2">
                        {b.outstanding > 0.005 && postable.length > 0 && (
                          <select
                            defaultValue=""
                            disabled={pending}
                            onChange={(e) => {
                              const txId = e.target.value;
                              e.target.value = "";
                              if (txId) act(() => postBill(b.id, txId));
                            }}
                            className="max-w-40 rounded-md border border-line bg-card px-2 py-1 text-xs"
                            title="Post this bill against a payment"
                          >
                            <option value="">Mark paid by…</option>
                            {postable
                              .filter((t) => t.date >= b.issueDate)
                              .map((t) => (
                                <option key={t.id} value={t.id}>
                                  {fmtDate(t.date)} · {money(Math.abs(t.amount))}
                                  {Math.abs(Math.abs(t.amount) - b.outstanding) <= 0.02
                                    ? " ✓ exact"
                                    : ""}
                                </option>
                              ))}
                          </select>
                        )}
                        {b.status !== "void" && b.amountPaid <= 0.005 && (
                          <button
                            className="text-xs text-ink-faint underline hover:text-money-out"
                            disabled={pending}
                            onClick={() => act(() => deleteBill(b.id, vendor.id))}
                          >
                            delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* ---- transactions ---- */}
      <div>
        <h2 className="mb-2 text-sm font-semibold">Payments from the bank</h2>
        <Card className="overflow-hidden">
          {transactions.length === 0 ? (
            <EmptyState
              title="Nothing attributed yet"
              hint="Attach this vendor to a payment on the Transactions screen, or with a rule that matches their name."
            />
          ) : (
            <table className="w-full">
              <thead className="border-b border-line bg-paper/60">
                <tr>
                  <th className="th">Date</th>
                  <th className="th">Description</th>
                  <th className="th">Bill</th>
                  <th className="th text-right">Amount</th>
                  <th className="th w-24"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {transactions.map((t) => (
                  <tr key={t.id} className={`hover:bg-paper/50 ${t.excluded ? "opacity-50" : ""}`}>
                    <td className="td text-ink-soft">{fmtDate(t.date)}</td>
                    <td className="td">
                      {t.description || "—"}
                      {t.excluded && (
                        <span className="ml-2 text-xs text-ink-faint">excluded</span>
                      )}
                    </td>
                    <td className="td text-xs">
                      {t.billLinked ? (
                        <span className="text-brand">posted</span>
                      ) : t.amount < 0 ? (
                        <span className="text-ink-faint">no bill</span>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                    <td
                      className={`td text-right tabular font-medium ${
                        t.amount < 0 ? "text-money-out" : "text-money-in"
                      }`}
                    >
                      {money(Math.abs(t.amount))}
                    </td>
                    <td className="td text-right">
                      <button
                        className="text-xs text-ink-faint underline hover:text-ink"
                        disabled={pending}
                        onClick={() => act(() => setTxVendor([t.id], null))}
                        title="Detach this payment from the vendor"
                      >
                        detach
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* ---- add a bill ---- */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={`Add a bill from ${vendor.name}`}
        footer={
          <>
            <button className="btn-outline" onClick={() => setAddOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" type="submit" form="bill-form" disabled={pending}>
              {pending ? "Saving…" : "Save bill"}
            </button>
          </>
        }
      >
        <form
          id="bill-form"
          onSubmit={(e) => {
            e.preventDefault();
            submitBill(new FormData(e.currentTarget));
          }}
          className="space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">Their reference</span>
              <input name="number" className="input" placeholder="INV-10482" />
            </label>
            <label className="block">
              <span className="label">Books to</span>
              <select name="categoryId" className="input" defaultValue={defaultCategoryId ?? ""}>
                <option value="">Uncategorised</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">Bill date</span>
              <input name="issueDate" type="date" required defaultValue={today()} className="input" />
            </label>
            <label className="block">
              <span className="label">Due date</span>
              <input name="dueDate" type="date" className="input" />
            </label>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="label">Net</span>
              <input
                name="net"
                type="number"
                step="0.01"
                min="0"
                required
                className="input tabular"
                value={net}
                onChange={(e) => setNet(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="label">VAT rate</span>
              <select
                name="vatRateId"
                className="input"
                value={vatRateId}
                onChange={(e) => {
                  setVatRateId(e.target.value);
                  setVatTouched(false);
                }}
              >
                <option value="">None</option>
                {vatRates.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">VAT amount</span>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input tabular"
                value={vatValue}
                onChange={(e) => {
                  setVatTouched(true);
                  setVatTotal(e.target.value);
                }}
              />
            </label>
          </div>
          {grossPreview && (
            <p className="text-xs text-ink-faint">
              Total <span className="tabular font-medium text-ink">{grossPreview}</span> — the
              figure the vendor will chase. VAT follows the rate until you type over it.
            </p>
          )}

          <label className="block">
            <span className="label">Document (optional)</span>
            <input
              name="file"
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp,image/heic"
              className="input"
            />
            <span className="mt-1 block text-xs text-ink-faint">
              PDF or image, up to 15 MB. Stored privately, not on a public link.
            </span>
          </label>

          {postable.length > 0 && (
            <label className="block">
              <span className="label">Already paid by</span>
              <select
                name="paidByTransactionId"
                className="input"
                value={payFrom}
                onChange={(e) => setPayFrom(e.target.value)}
              >
                <option value="">Not paid yet — record it as owed</option>
                {postable.map((t) => (
                  <option key={t.id} value={t.id}>
                    {fmtDate(t.date)} · {money(Math.abs(t.amount))} · {t.description.slice(0, 40)}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-ink-faint">
                Pick the bank line that paid it, or leave it as owed and post the payment later.
              </span>
            </label>
          )}

          <label className="block">
            <span className="label">Notes</span>
            <textarea name="notes" rows={2} className="input" />
          </label>
        </form>
      </Modal>
    </div>
  );
}
