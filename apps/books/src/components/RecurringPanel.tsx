"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { money, fmtDate } from "@/lib/format";
import { Card } from "@/components/ui";
import {
  IconPlus,
  IconRepeat,
  IconPause,
  IconPlay,
  IconEdit,
  IconTrash,
} from "@/components/icons";
import {
  generateDueInvoices,
  setRecurringStatusAction,
  deleteRecurringAction,
} from "@/app/actions";

type Row = {
  id: string;
  name: string;
  customerName: string;
  status: string;
  frequency: string;
  interval: number;
  nextRunDate: string;
  due: boolean;
  occurrencesCount: number;
  autoSend: boolean;
};

const FREQ: Record<string, string> = {
  weekly: "week",
  monthly: "month",
  quarterly: "quarter",
  yearly: "year",
};

export function RecurringPanel({
  recurring,
  dueCount,
}: {
  recurring: Row[];
  dueCount: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function generate() {
    startTransition(async () => {
      const r = await generateDueInvoices();
      setMsg(`Generated ${r.generated} invoice${r.generated === 1 ? "" : "s"} from ${r.profiles} schedule${r.profiles === 1 ? "" : "s"}.`);
      router.refresh();
      setTimeout(() => setMsg(null), 5000);
    });
  }
  function toggle(id: string, status: string) {
    startTransition(async () => {
      await setRecurringStatusAction(id, status === "active" ? "paused" : "active");
      router.refresh();
    });
  }
  function del(id: string) {
    if (!confirm("Delete this recurring schedule? Already-generated invoices are kept.")) return;
    startTransition(async () => {
      await deleteRecurringAction(id);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {dueCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand/30 bg-brand-wash px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-white">
              <IconRepeat className="h-5 w-5" />
            </span>
            <div>
              <div className="font-semibold text-brand-dark">
                {dueCount} recurring invoice{dueCount === 1 ? "" : "s"} ready to generate
              </div>
              <div className="text-sm text-ink-soft">
                Including any periods missed since the app was last open.
              </div>
            </div>
          </div>
          <button className="btn-primary" onClick={generate}>
            Generate now
          </button>
        </div>
      )}

      {msg && (
        <div className="rounded-lg bg-brand-wash px-4 py-2.5 text-sm text-brand-dark">{msg}</div>
      )}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold">Recurring schedules</h2>
          <Link href="/invoices/recurring/new" className="btn-outline py-1.5">
            <IconPlus className="h-4 w-4" /> New schedule
          </Link>
        </div>
        {recurring.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-ink-faint">
            No recurring schedules. Set one up for retainers or subscriptions and
            cashish will generate the invoices for you.
          </div>
        ) : (
          <table className="w-full">
            <thead className="border-b border-line bg-paper/60">
              <tr>
                <th className="th">Schedule</th>
                <th className="th">Customer</th>
                <th className="th">Frequency</th>
                <th className="th">Next</th>
                <th className="th">Status</th>
                <th className="th w-28"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {recurring.map((r) => (
                <tr key={r.id} className="hover:bg-paper/50">
                  <td className="td">
                    <div className="font-medium">{r.name || "Untitled schedule"}</div>
                    <div className="text-xs text-ink-faint">
                      {r.occurrencesCount} generated · {r.autoSend ? "auto-sent" : "drafts"}
                    </div>
                  </td>
                  <td className="td">{r.customerName}</td>
                  <td className="td text-ink-soft">
                    Every {r.interval > 1 ? `${r.interval} ` : ""}
                    {FREQ[r.frequency]}{r.interval > 1 ? "s" : ""}
                  </td>
                  <td className="td tabular">
                    <span className={r.due ? "font-medium text-brand" : "text-ink-soft"}>
                      {fmtDate(r.nextRunDate)}
                    </span>
                  </td>
                  <td className="td">
                    <span className={`badge ${r.status === "active" ? "bg-brand-wash text-brand-dark" : "bg-black/5 text-ink-faint"}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="td">
                    <div className="flex items-center justify-end gap-1">
                      <button className="btn-ghost px-2 py-1" title={r.status === "active" ? "Pause" : "Resume"} onClick={() => toggle(r.id, r.status)}>
                        {r.status === "active" ? <IconPause className="h-4 w-4" /> : <IconPlay className="h-4 w-4" />}
                      </button>
                      <Link href={`/invoices/recurring/${r.id}`} className="btn-ghost px-2 py-1" title="Edit">
                        <IconEdit className="h-4 w-4" />
                      </Link>
                      <button className="btn-ghost px-2 py-1 hover:text-money-out" title="Delete" onClick={() => del(r.id)}>
                        <IconTrash className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
