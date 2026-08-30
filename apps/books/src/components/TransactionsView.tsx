"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Transaction, Category, VatRate } from "@/db/schema";
import { moneySigned, fmtDate, money } from "@/lib/format";
import {
  importStatement,
  categorizeTx,
  setTxVat,
  bulkCategorizeTx,
  setTxEmployeeAction,
  setTxVendorAction,
  applyRulesAction,
  setExcludedAction,
} from "@/app/actions";
import type { ImportSummary } from "@/lib/transactions";
import { Card, EmptyState, Dot } from "@/components/ui";
import { ReceiptsModal } from "@/components/ReceiptsModal";
import {
  IconUpload,
  IconSearch,
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconPaperclip,
  IconWand,
} from "@/components/icons";

type Props = {
  transactions: Transaction[];
  categories: Category[];
  vatRates: VatRate[];
  receiptCounts: Record<string, number>;
  /** People this business pays, for attributing a payment to one of them. */
  people?: { id: string; name: string }[];
  /** Suppliers, for attributing a payment to one of them. */
  vendors?: { id: string; name: string }[];
  initialFilter?: string;
};

export function TransactionsView({
  transactions,
  categories,
  vatRates,
  receiptCounts,
  people = [],
  vendors = [],
  initialFilter,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<"all" | "in" | "out">("all");
  const [onlyUncat, setOnlyUncat] = useState(initialFilter === "uncategorized");
  // Excluded transactions live in their own tab rather than cluttering the ledger.
  const [tab, setTab] = useState<"active" | "excluded">("active");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [importing, setImporting] = useState(false);
  const [receiptTx, setReceiptTx] = useState<Transaction | null>(null);
  const [rulesMsg, setRulesMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const catMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );
  const vatMap = useMemo(
    () => new Map(vatRates.map((v) => [v.id, v])),
    [vatRates],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return transactions.filter((t) => {
      if (tab === "active" ? t.excluded : !t.excluded) return false;
      if (direction === "in" && t.amount < 0) return false;
      if (direction === "out" && t.amount >= 0) return false;
      if (onlyUncat && t.categoryId) return false;
      if (q) {
        const hay = `${t.description} ${t.reference} ${t.payer}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [transactions, search, direction, onlyUncat, tab]);

  const totals = useMemo(() => {
    let inSum = 0,
      outSum = 0;
    for (const t of filtered) {
      if (t.amount >= 0) inSum += t.amount;
      else outSum += Math.abs(t.amount);
    }
    return { inSum, outSum, net: inSum - outSum };
  }, [filtered]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setSummary(null);
    const fd = new FormData();
    fd.append("file", file);
    const result = await importStatement(fd);
    setSummary(result);
    setImporting(false);
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  function refresh() {
    startTransition(() => router.refresh());
  }

  function onCategory(t: Transaction, categoryId: string) {
    startTransition(async () => {
      await categorizeTx(t.id, categoryId || null);
      router.refresh();
    });
  }
  function onVat(t: Transaction, vatRateId: string) {
    startTransition(async () => {
      await setTxVat(t.id, vatRateId || null);
      router.refresh();
    });
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((t) => t.id)));
  }

  function onEmployee(t: Transaction, employeeId: string) {
    startTransition(async () => {
      await setTxEmployeeAction([t.id], employeeId || null);
      router.refresh();
    });
  }

  function onVendor(t: Transaction, vendorId: string) {
    startTransition(async () => {
      await setTxVendorAction([t.id], vendorId || null);
      router.refresh();
    });
  }

  function bulkAssign(categoryId: string) {
    const ids = [...selected];
    startTransition(async () => {
      await bulkCategorizeTx(ids, categoryId || null);
      setSelected(new Set());
      router.refresh();
    });
  }

  function applyRules() {
    startTransition(async () => {
      const r = await applyRulesAction();
      // The overwrite count is called out, because that is the destructive half.
      const changed = `${r.updated} transaction${r.updated === 1 ? "" : "s"} categorised`;
      setRulesMsg(
        r.recategorised > 0
          ? `Rules re-applied — ${changed}, ${r.recategorised} of them recategorised.`
          : `Rules re-applied — ${changed}.`,
      );
      router.refresh();
      setTimeout(() => setRulesMsg(null), 5000);
    });
  }

  function exclude(exclude: boolean) {
    const ids = [...selected];
    const reason = exclude
      ? (window.prompt(
          "Why is this out of the books? (internal transfer, personal spend, duplicate…)",
          "",
        ) ?? "")
      : "";
    // A cancelled prompt returns null, which we read as "no reason given", not "abort" —
    // the reason is useful, not mandatory.
    startTransition(async () => {
      await setExcludedAction(ids, exclude, reason);
      setSelected(new Set());
      setRulesMsg(
        exclude
          ? `${ids.length} transaction${ids.length === 1 ? "" : "s"} excluded — no longer counted anywhere.`
          : `${ids.length} transaction${ids.length === 1 ? "" : "s"} put back in the books.`,
      );
      router.refresh();
      setTimeout(() => setRulesMsg(null), 5000);
    });
  }

  const activeTx = transactions.filter((t) => !t.excluded);
  const excludedCount = transactions.length - activeTx.length;
  const uncatCount = activeTx.filter((t) => !t.categoryId).length;

  return (
    <div>
      {/* Import panel */}
      <Card className="mb-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold">Import bank statement</h2>
            <p className="text-sm text-ink-faint mt-0.5">
              Upload a Revolut CSV. Re-uploading overlapping statements is safe —
              only new transactions are added (matched on transaction ID).
            </p>
          </div>
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={onFile}
            />
            <button
              className="btn-primary"
              disabled={importing}
              onClick={() => fileRef.current?.click()}
            >
              <IconUpload className="h-4 w-4" />
              {importing ? "Importing…" : "Choose CSV"}
            </button>
          </div>
        </div>
        {summary && (
          <div className="mt-4 rounded-lg border border-line bg-paper px-4 py-3 text-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span>
                <strong className="text-brand">{summary.inserted}</strong> new
                transaction{summary.inserted === 1 ? "" : "s"} imported
              </span>
              <span className="text-ink-faint">
                {summary.duplicates} already on file (skipped)
              </span>
              {summary.autoCategorized > 0 && (
                <span className="text-brand">
                  {summary.autoCategorized} auto-categorised by rules
                </span>
              )}
              <span className="text-ink-faint">{summary.parsed} rows read</span>
            </div>
            {summary.errors.length > 0 && (
              <ul className="mt-2 list-inside list-disc text-money-out">
                {summary.errors.slice(0, 5).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
                {summary.errors.length > 5 && (
                  <li>…and {summary.errors.length - 5} more</li>
                )}
              </ul>
            )}
          </div>
        )}
      </Card>

      {/* Filter bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input
            className="input pl-9"
            placeholder="Search description, reference, payer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="seg inline-flex rounded-lg border border-line bg-card p-1 text-sm">
          {(["all", "in", "out"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDirection(d)}
              className={`rounded-md px-3 py-1.5 font-medium capitalize transition-colors ${
                direction === d
                  ? "bg-brand text-white"
                  : "text-ink-soft hover:bg-black/5"
              }`}
            >
              {d === "all" ? "All" : d === "in" ? "Money in" : "Money out"}
            </button>
          ))}
        </div>
        <button
          onClick={() => setOnlyUncat((v) => !v)}
          className={`btn ${onlyUncat ? "btn-primary" : "btn-outline"}`}
        >
          Uncategorised {uncatCount > 0 && `(${uncatCount})`}
        </button>
        <button
          onClick={applyRules}
          className="btn-outline"
          title="Re-apply every enabled rule across the ledger, including transactions that already have a category"
        >
          <IconWand className="h-4 w-4" /> Apply rules
        </button>
      </div>

      {rulesMsg && (
        <div className="mb-3 rounded-lg bg-brand-wash px-4 py-2.5 text-sm text-brand-dark">
          {rulesMsg}
        </div>
      )}

      {/* Ledger / excluded */}
      <div className="mb-3 flex items-center gap-1 border-b border-line">
        {([
          ["active", "Ledger", activeTx.length],
          ["excluded", "Excluded", excludedCount],
        ] as const).map(([key, label, n]) => (
          <button
            key={key}
            onClick={() => {
              setTab(key);
              setSelected(new Set());
            }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === key
                ? "border-brand font-medium text-brand-dark"
                : "border-transparent text-ink-faint hover:text-ink"
            }`}
          >
            {label} {n > 0 && <span className="text-ink-faint">({n})</span>}
          </button>
        ))}
        {tab === "excluded" && (
          <p className="ml-3 text-xs text-ink-faint">
            Still on record so a statement reconciles, but counted in no report, no VAT
            return and nothing Lunar is told.
          </p>
        )}
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-brand/30 bg-brand-wash px-4 py-2.5 text-sm">
          <span className="font-medium text-brand-dark">
            {selected.size} selected
          </span>
          {tab === "active" && (
            <>
              <span className="text-ink-faint">Assign category:</span>
              <select
                className="input max-w-xs py-1.5"
                defaultValue=""
                onChange={(e) => e.target.value && bulkAssign(e.target.value)}
              >
                <option value="" disabled>
                  Choose category…
                </option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.kind})
                  </option>
                ))}
              </select>
            </>
          )}
          {tab === "active" ? (
            <button
              className="btn-outline"
              onClick={() => exclude(true)}
              title="Take these out of the books: kept on record, counted nowhere"
            >
              Exclude
            </button>
          ) : (
            <button className="btn-outline" onClick={() => exclude(false)}>
              Put back in the books
            </button>
          )}
          <button
            className="btn-ghost ml-auto"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            title="No transactions"
            hint="Import a bank statement above to get started, or adjust your filters."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line bg-paper/60">
                <tr>
                  <th className="th w-8">
                    <input
                      type="checkbox"
                      checked={
                        selected.size === filtered.length && filtered.length > 0
                      }
                      onChange={toggleAll}
                      className="accent-brand"
                    />
                  </th>
                  <th className="th w-28">Date</th>
                  <th className="th">Description</th>
                  <th className="th w-56">Category</th>
                  <th className="th w-36">VAT</th>
                  {people.length > 0 && <th className="th w-40">Paid to</th>}
                  {vendors.length > 0 && <th className="th w-44">Vendor</th>}
                  <th className="th w-32 text-right">Amount</th>
                  <th className="th w-16 text-center">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((t) => {
                  const cat = t.categoryId ? catMap.get(t.categoryId) : null;
                  const isOut = t.amount < 0;
                  return (
                    <tr
                      key={t.id}
                      className={`hover:bg-paper/50 ${
                        selected.has(t.id) ? "bg-brand-wash/40" : ""
                      }`}
                    >
                      <td className="td">
                        <input
                          type="checkbox"
                          checked={selected.has(t.id)}
                          onChange={() => toggle(t.id)}
                          className="accent-brand"
                        />
                      </td>
                      <td className="td whitespace-nowrap text-ink-soft tabular">
                        {fmtDate(t.bookedDate)}
                      </td>
                      <td className="td">
                        <div className="flex items-center gap-2">
                          <span
                            className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${
                              isOut
                                ? "bg-money-out/10 text-money-out"
                                : "bg-money-in/10 text-money-in"
                            }`}
                          >
                            {isOut ? (
                              <IconArrowUp className="h-3.5 w-3.5" />
                            ) : (
                              <IconArrowDown className="h-3.5 w-3.5" />
                            )}
                          </span>
                          <div className="min-w-0">
                            <div className="truncate font-medium">
                              {t.description || t.reference || t.type}
                            </div>
                            {(t.reference || t.type) && (
                              <div className="truncate text-xs text-ink-faint">
                                {[t.type, t.reference].filter(Boolean).join(" · ")}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="td">
                        <div className="flex items-center gap-1.5">
                          {cat && <Dot color={cat.color ?? "#9ca3af"} />}
                          <select
                            value={t.categoryId ?? ""}
                            onChange={(e) => onCategory(t, e.target.value)}
                            className={`w-full rounded-md border px-2 py-1 text-sm outline-none focus:border-brand ${
                              cat
                                ? "border-line bg-card"
                                : "border-amber-300 bg-amber-50 text-amber-800"
                            }`}
                          >
                            <option value="">Uncategorised</option>
                            <optgroup label="Income">
                              {categories
                                .filter((c) => c.kind === "income")
                                .map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                            </optgroup>
                            <optgroup label="Expense">
                              {categories
                                .filter((c) => c.kind === "expense")
                                .map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                            </optgroup>
                          </select>
                        </div>
                      </td>
                      <td className="td">
                        <select
                          value={t.vatRateId ?? ""}
                          onChange={(e) => onVat(t, e.target.value)}
                          className="w-full rounded-md border border-line bg-card px-2 py-1 text-sm outline-none focus:border-brand"
                        >
                          <option value="">No VAT</option>
                          {vatRates.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      {vendors.length > 0 && (
                        <td className="td">
                          {isOut ? (
                            <select
                              value={t.vendorId ?? ""}
                              onChange={(e) => onVendor(t, e.target.value)}
                              className="w-full rounded-md border border-line bg-card px-2 py-1 text-sm outline-none focus:border-brand"
                            >
                              <option value="">—</option>
                              {vendors.map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-ink-faint">—</span>
                          )}
                        </td>
                      )}
                      {people.length > 0 && (
                        <td className="td">
                          {/* Only meaningful for money going out, so the control
                              is only offered there. */}
                          {isOut ? (
                            <select
                              value={t.employeeId ?? ""}
                              onChange={(e) => onEmployee(t, e.target.value)}
                              className="w-full rounded-md border border-line bg-card px-2 py-1 text-sm outline-none focus:border-brand"
                            >
                              <option value="">—</option>
                              {people.map((pp) => (
                                <option key={pp.id} value={pp.id}>
                                  {pp.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-ink-faint">—</span>
                          )}
                        </td>
                      )}
                      <td
                        className={`td text-right tabular font-semibold ${
                          isOut ? "text-money-out" : "text-money-in"
                        }`}
                      >
                        {moneySigned(t.amount)}
                      </td>
                      <td className="td text-center">
                        <button
                          onClick={() => setReceiptTx(t)}
                          title={
                            receiptCounts[t.id]
                              ? `${receiptCounts[t.id]} receipt(s)`
                              : "Attach receipt"
                          }
                          className={`relative inline-grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-black/5 ${
                            receiptCounts[t.id] ? "text-brand" : "text-ink-faint"
                          }`}
                        >
                          <IconPaperclip className="h-4 w-4" />
                          {receiptCounts[t.id] > 0 && (
                            <span className="absolute -right-0.5 -top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-brand px-0.5 text-[9px] font-bold text-white">
                              {receiptCounts[t.id]}
                            </span>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-line bg-paper/60">
                <tr>
                  <td className="td" colSpan={4}>
                    <span className="text-sm text-ink-faint">
                      {filtered.length} transaction
                      {filtered.length === 1 ? "" : "s"}
                    </span>
                  </td>
                  <td className="td text-right text-xs text-ink-faint">
                    <div className="text-money-in">in {money(totals.inSum)}</div>
                    <div className="text-money-out">
                      out {money(totals.outSum)}
                    </div>
                  </td>
                  <td className="td text-right tabular font-bold">
                    {moneySigned(totals.net)}
                  </td>
                  <td className="td" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
      {pending && (
        <div className="fixed bottom-4 right-4 rounded-lg bg-ink px-3 py-2 text-xs text-white shadow-pop">
          Saving…
        </div>
      )}

      <ReceiptsModal
        transaction={receiptTx}
        open={!!receiptTx}
        onClose={() => setReceiptTx(null)}
      />
    </div>
  );
}
