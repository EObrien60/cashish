"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { money, fmtDate } from "@/lib/format";
import { Card, EmptyState } from "./ui";
import {
  uploadDocumentsAction,
  rereadDocumentAction,
  confirmDocumentAsBillAction,
  attachDocumentToTransactionAction,
  candidateTransactionsAction,
  rejectDocumentAction,
  deleteDocumentAction,
} from "@/app/actions";
import type { DocumentRow } from "@/lib/documents";

const KIND_LABEL: Record<string, string> = {
  bill: "Bill from a supplier",
  sales_invoice: "Invoice you issued",
  receipt: "Receipt",
  payslip: "Payslip",
  other: "Something else",
};

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "bg-emerald-50 text-emerald-700",
  medium: "bg-amber-50 text-amber-700",
  low: "bg-rose-50 text-rose-700",
};

type Candidate = { id: string; date: string; amount: number; description: string };

/**
 * One document, read and awaiting a decision.
 *
 * Every field is editable before confirming, and the form is seeded from the
 * extraction rather than bound to it — what gets saved is what is on screen,
 * which is what makes a correction mean anything. The extraction stays on
 * record either way.
 */
function Review({ doc }: { doc: DocumentRow }) {
  const router = useRouter();
  const [, start] = useTransition();
  const e = doc.extraction;

  const [vendorName, setVendorName] = useState(e?.counterparty ?? "");
  const [number, setNumber] = useState(e?.documentNumber ?? "");
  const [issueDate, setIssueDate] = useState(e?.issueDate ?? "");
  const [dueDate, setDueDate] = useState(e?.dueDate ?? "");
  const [net, setNet] = useState(e?.net != null ? String(e.net) : "");
  const [vat, setVat] = useState(e?.tax != null ? String(e.tax) : "");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = (Number(net) || 0) + (Number(vat) || 0);
  const printedGross = e?.gross ?? null;
  // If the printed total and the fields disagree, say so rather than silently
  // preferring one: a mis-read VAT line is exactly what review is for.
  const disagrees =
    printedGross != null && Math.abs(total - printedGross) > 0.005 && (net !== "" || vat !== "");

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <a
            href={`/api/documents/${doc.id}/file`}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-brand underline"
          >
            {doc.fileName}
          </a>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
            <span>{KIND_LABEL[doc.kind] ?? doc.kind}</span>
            {e && (
              <span className={`rounded px-1.5 py-0.5 ${CONFIDENCE_STYLE[e.confidence] ?? ""}`}>
                {e.confidence} confidence
              </span>
            )}
            <span>{fmtDate(doc.uploadedAt)}</span>
            {e?.currency && e.currency !== "EUR" && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">
                {e.currency} — not this book&rsquo;s currency
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            className="btn-ghost text-xs"
            onClick={() => start(async () => { await rereadDocumentAction(doc.id); router.refresh(); })}
          >
            Read again
          </button>
          <button
            className="btn-ghost text-xs"
            onClick={() => start(async () => { await rejectDocumentAction(doc.id); router.refresh(); })}
          >
            Not needed
          </button>
          <button
            className="btn-ghost text-xs text-money-out"
            onClick={() => start(async () => { await deleteDocumentAction(doc.id); router.refresh(); })}
          >
            Delete
          </button>
        </div>
      </div>

      {doc.status === "failed" && (
        <p className="text-sm text-money-out">Could not be read: {doc.error}</p>
      )}

      {e && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-ink-soft">Supplier</span>
              <input className="input w-full" value={vendorName} onChange={(ev) => setVendorName(ev.target.value)} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-ink-soft">Their reference</span>
              <input className="input w-full" value={number} onChange={(ev) => setNumber(ev.target.value)} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-ink-soft">Issued</span>
              <input type="date" className="input w-full" value={issueDate} onChange={(ev) => setIssueDate(ev.target.value)} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-ink-soft">Due</span>
              <input type="date" className="input w-full" value={dueDate} onChange={(ev) => setDueDate(ev.target.value)} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-ink-soft">Net</span>
              <input inputMode="decimal" className="input w-full" value={net} onChange={(ev) => setNet(ev.target.value)} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-ink-soft">VAT</span>
              <input inputMode="decimal" className="input w-full" value={vat} onChange={(ev) => setVat(ev.target.value)} />
            </label>
          </div>

          <p className="text-sm text-ink-soft">
            Total {money(total)}
            {printedGross != null && ` · the document says ${money(printedGross)}`}
          </p>
          {disagrees && (
            <p className="text-sm text-money-out">
              Net plus VAT does not match the total printed on the document. Check which is right
              before confirming — this is the kind of thing that ends up in a VAT return.
            </p>
          )}

          {e.notes && <p className="text-xs text-ink-faint">Noted: {e.notes}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn-primary"
              disabled={busy || !vendorName.trim() || !issueDate}
              onClick={() => {
                setBusy(true);
                setError(null);
                start(async () => {
                  try {
                    await confirmDocumentAsBillAction(doc.id, {
                      vendorName: vendorName.trim(),
                      number: number.trim() || undefined,
                      issueDate,
                      dueDate: dueDate || null,
                      net: Number(net) || 0,
                      vatTotal: Number(vat) || 0,
                    });
                    router.refresh();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not create the bill.");
                  }
                  setBusy(false);
                });
              }}
            >
              {busy ? "Saving…" : "Create bill"}
            </button>
            <button
              className="btn-outline"
              onClick={() =>
                start(async () => {
                  setCandidates(await candidateTransactionsAction(doc.id));
                })
              }
            >
              Find the payment
            </button>
          </div>

          {candidates && candidates.length === 0 && (
            <p className="text-sm text-ink-faint">
              No bank line matches this amount within three weeks of its date.
            </p>
          )}
          {candidates && candidates.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-ink-faint">
                Bank lines for the same amount, near the date — attaching keeps the document with
                the payment:
              </p>
              {candidates.map((c) => (
                <div key={c.id} className="flex items-center gap-3 rounded border border-line px-3 py-1.5 text-sm">
                  <span className="w-24 text-ink-soft">{fmtDate(c.date)}</span>
                  <span className="flex-1 truncate">{c.description}</span>
                  <span className="tabular-nums">{money(c.amount)}</span>
                  <button
                    className="text-xs text-brand underline"
                    onClick={() =>
                      start(async () => {
                        await attachDocumentToTransactionAction(doc.id, c.id);
                        router.refresh();
                      })
                    }
                  >
                    Attach
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && <p className="text-sm text-money-out">{error}</p>}
        </>
      )}
    </Card>
  );
}

export function DocumentsView({
  pending,
  done,
  aiAvailable,
}: {
  pending: DocumentRow[];
  done: DocumentRow[];
  aiAvailable: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  async function upload(files: FileList) {
    setBusy(true);
    setSummary(null);
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append("files", f);
    const result = await uploadDocumentsAction(fd);
    setBusy(false);
    if ("error" in result && result.error) setSummary(result.error);
    else if ("results" in result) {
      const failed = result.results.filter((r) => !r.ok);
      setSummary(
        failed.length === 0
          ? `${result.results.length} read.`
          : `${result.results.length - failed.length} read, ${failed.length} could not be: ${failed[0]?.reason ?? ""}`,
      );
    }
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {aiAvailable && (
        <Card>
          <h2 className="font-semibold">Add documents</h2>
          <p className="mt-0.5 text-sm text-ink-faint">
            Invoices, receipts, payslips — several at once. Each is read into fields and waits
            here until you confirm it. Nothing reaches the books on its own.
          </p>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="application/pdf,image/*"
            className="hidden"
            onChange={(e) => e.target.files?.length && upload(e.target.files)}
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="btn-primary" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? "Reading…" : "Choose files"}
            </button>
            {summary && <span className="text-sm text-ink-soft">{summary}</span>}
          </div>
        </Card>
      )}

      {pending.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          hint="Documents you upload appear here with what was read off them, for you to check before anything is created."
        />
      ) : (
        <>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">
            Waiting for you ({pending.length})
          </h2>
          {pending.map((d) => (
            <Review key={d.id} doc={d} />
          ))}
        </>
      )}

      {done.length > 0 && (
        <Card className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-black/[0.02] text-ink-soft">
                <th className="px-4 py-2 text-left font-semibold">Document</th>
                <th className="px-4 py-2 text-left font-semibold">Kind</th>
                <th className="px-4 py-2 text-left font-semibold">Outcome</th>
                <th className="px-4 py-2 text-left font-semibold">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {done.map((d) => (
                <tr key={d.id} className="border-t border-line/60">
                  <td className="px-4 py-2">
                    <a href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer" className="underline">
                      {d.fileName}
                    </a>
                  </td>
                  <td className="px-4 py-2 text-ink-soft">{KIND_LABEL[d.kind] ?? d.kind}</td>
                  <td className="px-4 py-2 text-ink-soft">
                    {d.status === "rejected"
                      ? "Not needed"
                      : d.billId
                        ? "Bill created"
                        : d.transactionId
                          ? "Attached to a payment"
                          : "Confirmed"}
                  </td>
                  <td className="px-4 py-2 text-ink-soft">{fmtDate(d.uploadedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
