"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { money, fmtDate, todayISO, round2 } from "@/lib/format";
import { Card } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { IconPrint, IconEdit, IconPlus, IconTrash, IconCheck } from "@/components/icons";
import {
  addPayment,
  removePayment,
  changeInvoiceStatus,
  deleteInvoiceAction,
} from "@/app/actions";
import type { Payment } from "@/db/schema";

type Props = {
  invoiceId: string;
  total: number;
  amountPaid: number;
  status: string;
  payments: Payment[];
};

export function InvoiceActions({
  invoiceId,
  total,
  amountPaid,
  status,
  payments,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [payOpen, setPayOpen] = useState(false);
  const due = round2(total - amountPaid);
  const [payAmount, setPayAmount] = useState(String(due > 0 ? due : 0));
  const [payDate, setPayDate] = useState(todayISO());
  const [payMethod, setPayMethod] = useState("bank");

  function recordPay() {
    const amt = Number(payAmount) || 0;
    if (amt <= 0) return;
    startTransition(async () => {
      await addPayment(invoiceId, {
        date: payDate,
        amount: amt,
        method: payMethod,
      });
      setPayOpen(false);
      router.refresh();
    });
  }

  function setStatus(s: string) {
    startTransition(async () => {
      await changeInvoiceStatus(invoiceId, s);
      router.refresh();
    });
  }

  function removePay(id: string) {
    startTransition(async () => {
      await removePayment(invoiceId, id);
      router.refresh();
    });
  }

  function del() {
    if (!confirm("Delete this invoice and its payments? This can't be undone."))
      return;
    startTransition(async () => {
      await deleteInvoiceAction(invoiceId);
      router.push("/invoices");
    });
  }

  return (
    <div className="no-print space-y-4">
      <Card className="p-5">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-faint">Invoice total</span>
            <span className="tabular font-medium">{money(total)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-faint">Paid</span>
            <span className="tabular font-medium text-money-in">
              {money(amountPaid)}
            </span>
          </div>
          <div className="flex justify-between border-t border-line pt-2 text-base">
            <span className="font-semibold">Balance due</span>
            <span
              className={`tabular font-bold ${
                due > 0.005 ? "text-money-out" : "text-money-in"
              }`}
            >
              {money(due)}
            </span>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {due > 0.005 && status !== "void" && (
            <button
              className="btn-primary w-full"
              onClick={() => {
                setPayAmount(String(due));
                setPayOpen(true);
              }}
            >
              <IconPlus className="h-4 w-4" /> Record payment
            </button>
          )}
          <button
            className="btn-outline w-full"
            onClick={() => window.print()}
          >
            <IconPrint className="h-4 w-4" /> Print / save PDF
          </button>
          <Link
            href={`/invoices/${invoiceId}/edit`}
            className="btn-outline w-full"
          >
            <IconEdit className="h-4 w-4" /> Edit
          </Link>
        </div>
      </Card>

      <Card className="p-5">
        <div className="label">Status</div>
        <div className="flex flex-wrap gap-2">
          {["draft", "sent", "paid", "void"].map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`badge capitalize ${
                status === s
                  ? "bg-brand text-white"
                  : "bg-black/5 text-ink-soft hover:bg-black/10"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-faint">
          Marking paid is automatic once payments cover the total.
        </p>
      </Card>

      {payments.length > 0 && (
        <Card className="p-5">
          <div className="label">Payments</div>
          <div className="space-y-2">
            {payments.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between text-sm"
              >
                <div>
                  <div className="font-medium tabular">{money(p.amount)}</div>
                  <div className="text-xs text-ink-faint">
                    {fmtDate(p.date)} · {p.method}
                  </div>
                </div>
                <button
                  className="text-ink-faint hover:text-money-out"
                  onClick={() => removePay(p.id)}
                  aria-label="Remove payment"
                >
                  <IconTrash className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <button onClick={del} className="btn-danger w-full">
        <IconTrash className="h-4 w-4" /> Delete invoice
      </button>

      <Modal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title="Record payment"
        footer={
          <>
            <button className="btn-outline" onClick={() => setPayOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={recordPay}>
              <IconCheck className="h-4 w-4" /> Record
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Amount</label>
              <input
                type="number"
                step="0.01"
                className="input tabular"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="label">Date received</label>
              <input
                type="date"
                className="input"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="label">Method</label>
            <select
              className="input"
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value)}
            >
              <option value="bank">Bank transfer</option>
              <option value="card">Card</option>
              <option value="cash">Cash</option>
              <option value="other">Other</option>
            </select>
          </div>
          <p className="text-xs text-ink-faint">
            On cash-basis VAT, the date received is when this sale's VAT is
            recognised on your return.
          </p>
        </div>
      </Modal>
    </div>
  );
}
