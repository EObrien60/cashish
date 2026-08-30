"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Receipt, Transaction } from "@cashish/core/db";
import { fmtDate, moneySigned } from "@/lib/format";
import { Modal } from "@/components/Modal";
import { IconUpload, IconTrash, IconFile } from "@/components/icons";
import { uploadReceipt, deleteReceiptAction } from "@/app/actions";

export function ReceiptsModal({
  transaction,
  open,
  onClose,
}: {
  transaction: Transaction | null;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function load(txId: string) {
    setLoading(true);
    const res = await fetch(`/api/transactions/${txId}/receipts`, { cache: "no-store" });
    if (res.ok) setReceipts(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    if (open && transaction) {
      setError("");
      load(transaction.id);
    }
  }, [open, transaction]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !transaction) return;
    setUploading(true);
    setError("");
    const fd = new FormData();
    fd.append("transactionId", transaction.id);
    fd.append("file", file);
    const res = await uploadReceipt(fd);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!res.ok) {
      setError(res.error ?? "Upload failed.");
      return;
    }
    await load(transaction.id);
    router.refresh();
  }

  function remove(id: string) {
    startTransition(async () => {
      await deleteReceiptAction(id);
      if (transaction) await load(transaction.id);
      router.refresh();
    });
  }

  if (!transaction) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Receipts"
      footer={
        <button className="btn-outline" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="mb-4 rounded-lg bg-paper px-4 py-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="font-medium">{transaction.description || transaction.type}</span>
          <span className={`tabular font-semibold ${transaction.amount < 0 ? "text-money-out" : "text-money-in"}`}>
            {moneySigned(transaction.amount)}
          </span>
        </div>
        <div className="text-xs text-ink-faint">{fmtDate(transaction.bookedDate)}</div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/heic,application/pdf"
        className="hidden"
        onChange={onFile}
      />
      <button className="btn-primary w-full" disabled={uploading} onClick={() => fileRef.current?.click()}>
        <IconUpload className="h-4 w-4" />
        {uploading ? "Uploading…" : "Attach receipt (image or PDF)"}
      </button>
      {error && <p className="mt-2 text-sm text-money-out">{error}</p>}

      <div className="mt-4 space-y-2">
        {loading ? (
          <p className="py-4 text-center text-sm text-ink-faint">Loading…</p>
        ) : receipts.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-faint">No receipts attached yet.</p>
        ) : (
          receipts.map((r) => {
            const isImage = r.mimeType.startsWith("image/");
            return (
              <div key={r.id} className="flex items-center gap-3 rounded-lg border border-line p-2">
                <a
                  href={`/api/receipts/${r.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md bg-paper"
                >
                  {isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/receipts/${r.id}`} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <IconFile className="h-6 w-6 text-ink-faint" />
                  )}
                </a>
                <div className="min-w-0 flex-1">
                  <a href={`/api/receipts/${r.id}`} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium text-brand hover:underline">
                    {r.fileName}
                  </a>
                  <div className="text-xs text-ink-faint">
                    {(r.size / 1024).toFixed(0)} KB · {fmtDate(r.createdAt)}
                  </div>
                </div>
                <button className="text-ink-faint hover:text-money-out" onClick={() => remove(r.id)} aria-label="Delete receipt">
                  <IconTrash className="h-4 w-4" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}
