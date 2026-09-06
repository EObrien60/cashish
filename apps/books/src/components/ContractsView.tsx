"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { money, fmtDate } from "@/lib/format";
import { Card, EmptyState } from "./ui";
import {
  saveContractAction,
  setContractStatusAction,
  deleteContractAction,
  attachContractDocumentAction,
} from "@/app/actions";
import type { ContractSummary } from "@/lib/contracts";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-black/5 text-ink-soft",
  active: "bg-emerald-50 text-emerald-700",
  completed: "bg-blue-50 text-blue-700",
  cancelled: "bg-black/5 text-ink-faint",
};

export function ContractsView({
  contracts,
  customers,
  includeClosed,
}: {
  contracts: ContractSummary[];
  customers: { id: string; name: string }[];
  includeClosed: boolean;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function create(form: HTMLFormElement) {
    const data = new FormData(form);
    const value = String(data.get("value") ?? "").trim();
    setError(null);
    start(async () => {
      await saveContractAction({
        customerId: String(data.get("customerId")),
        name: String(data.get("name")),
        reference: String(data.get("reference") ?? ""),
        startDate: String(data.get("startDate")),
        endDate: String(data.get("endDate") ?? "") || null,
        // Left blank on purpose for a retainer: an agreed total that was never
        // agreed is worse than no number at all.
        value: value === "" ? null : Number(value),
        terms: String(data.get("terms") ?? ""),
      });
      setAdding(false);
      form.reset();
      router.refresh();
    });
  }

  async function upload(contractId: string, file: File) {
    setUploading(contractId);
    const fd = new FormData();
    fd.append("contractId", contractId);
    fd.append("file", file);
    const result = await attachContractDocumentAction(fd);
    setUploading(null);
    if (result && "error" in result && result.error) setError(result.error);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={includeClosed ? "/contracts" : "/contracts?closed=1"}
          className="text-sm text-brand underline"
          prefetch={false}
        >
          {includeClosed ? "Hide completed and cancelled" : "Show completed and cancelled"}
        </Link>
        <button className="btn-primary" onClick={() => setAdding((v) => !v)}>
          {adding ? "Cancel" : "New contract"}
        </button>
      </div>

      {adding && (
        <Card>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create(e.currentTarget);
            }}
            className="grid gap-3 sm:grid-cols-2"
          >
            <label className="text-sm">
              <span className="block text-xs font-medium text-ink-soft mb-1">Customer</span>
              <select name="customerId" required className="input w-full">
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-xs font-medium text-ink-soft mb-1">Name</span>
              <input name="name" required placeholder="Platform build, year one" className="input w-full" />
            </label>
            <label className="text-sm">
              <span className="block text-xs font-medium text-ink-soft mb-1">Their reference</span>
              <input name="reference" placeholder="PO-2026-114" className="input w-full" />
            </label>
            <label className="text-sm">
              <span className="block text-xs font-medium text-ink-soft mb-1">
                Agreed value (ex VAT) — blank for a retainer
              </span>
              <input name="value" inputMode="decimal" placeholder="60000" className="input w-full" />
            </label>
            <label className="text-sm">
              <span className="block text-xs font-medium text-ink-soft mb-1">Starts</span>
              <input name="startDate" type="date" required className="input w-full" />
            </label>
            <label className="text-sm">
              <span className="block text-xs font-medium text-ink-soft mb-1">
                Ends — blank if open-ended
              </span>
              <input name="endDate" type="date" className="input w-full" />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="block text-xs font-medium text-ink-soft mb-1">Terms</span>
              <input name="terms" placeholder="Net 30, invoiced monthly in arrears" className="input w-full" />
            </label>
            <div className="sm:col-span-2">
              <button type="submit" className="btn-primary">
                Create contract
              </button>
            </div>
          </form>
        </Card>
      )}

      {error && <p className="text-sm text-money-out">{error}</p>}

      {contracts.length === 0 ? (
        <EmptyState
          title="No contracts yet"
          hint="A contract records what you agreed with a customer — the term, the value, the terms and the signed copy — and totals everything invoiced against it."
        />
      ) : (
        <Card className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-ink-soft bg-black/[0.02]">
                <th className="px-4 py-2 text-left font-semibold">Contract</th>
                <th className="px-4 py-2 text-left font-semibold">Term</th>
                <th className="px-4 py-2 text-right font-semibold">Value</th>
                <th className="px-4 py-2 text-right font-semibold">Invoiced</th>
                <th className="px-4 py-2 text-right font-semibold">Remaining</th>
                <th className="px-4 py-2 text-left font-semibold">Document</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id} className="border-t border-line/60 align-top">
                  <td className="px-4 py-2">
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-ink-faint">
                      {c.customerName}
                      {c.reference && ` · ${c.reference}`}
                    </div>
                    <span
                      className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                        STATUS_STYLES[c.status] ?? "bg-black/5"
                      }`}
                    >
                      {c.status}
                    </span>
                    {c.expired && (
                      <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-700">
                        past its end date
                      </span>
                    )}
                    {c.scheduleCount > 0 && (
                      <span className="ml-1 text-[10px] uppercase tracking-wide text-ink-faint">
                        {c.scheduleCount} schedule{c.scheduleCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-ink-soft whitespace-nowrap">
                    {fmtDate(c.startDate)}
                    <div className="text-xs text-ink-faint">
                      {c.endDate ? `to ${fmtDate(c.endDate)}` : "open-ended"}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {c.value == null ? <span className="text-ink-faint">—</span> : money(c.value)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {money(c.invoiced)}
                    <div className="text-xs text-ink-faint">{money(c.received)} received</div>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {/* An open-ended contract has no remainder to state. */}
                    {c.remaining == null ? (
                      <span className="text-ink-faint" title="Open-ended: it bills whatever it bills">
                        —
                      </span>
                    ) : (
                      <span className={c.remaining < 0 ? "text-money-out" : ""}>
                        {money(c.remaining)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {c.hasDocument ? (
                      <a
                        href={`/api/contracts/${c.id}/document`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand underline text-xs"
                      >
                        View signed copy
                      </a>
                    ) : (
                      <label className="text-xs text-ink-faint underline cursor-pointer">
                        {uploading === c.id ? "Uploading…" : "Attach"}
                        <input
                          type="file"
                          className="hidden"
                          accept=".pdf,image/*"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void upload(c.id, f);
                          }}
                        />
                      </label>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {c.status === "active" && (
                      <button
                        className="text-xs text-ink-faint underline"
                        onClick={() =>
                          start(async () => {
                            await setContractStatusAction(c.id, "completed");
                            router.refresh();
                          })
                        }
                      >
                        Complete
                      </button>
                    )}
                    <button
                      className="ml-3 text-xs text-ink-faint underline"
                      title="The invoices raised under it are kept"
                      onClick={() =>
                        start(async () => {
                          await deleteContractAction(c.id);
                          router.refresh();
                        })
                      }
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
