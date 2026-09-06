"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setBudgetAction, copyBudgetAction, suggestBudgetAction } from "@/app/actions";

/**
 * An amount you edit in place.
 *
 * Budgeting is fifteen small numbers typed in one sitting, so every one of them
 * behind a modal would be fifteen modals. It saves on blur and on Enter, and
 * leaves the typed value on screen while the server catches up rather than
 * flashing back to the old figure.
 */
export function BudgetAmount({
  categoryId,
  month,
  amount,
}: {
  categoryId: string;
  month: string;
  amount: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [value, setValue] = useState(amount === 0 ? "" : String(amount));
  const [saving, setSaving] = useState(false);

  function commit() {
    const next = value.trim() === "" ? 0 : Number(value);
    if (!Number.isFinite(next) || next === amount) return;
    setSaving(true);
    startTransition(async () => {
      await setBudgetAction(categoryId, month, next);
      setSaving(false);
      router.refresh();
    });
  }

  return (
    <input
      inputMode="decimal"
      className={`input w-28 text-right tabular-nums ${saving ? "opacity-60" : ""}`}
      placeholder="—"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setValue(amount === 0 ? "" : String(amount));
      }}
    />
  );
}

export function CopyLastMonth({ month, from }: { month: string; from: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  return (
    <button
      className="btn-outline"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        startTransition(async () => {
          await copyBudgetAction(from, month);
          setBusy(false);
          router.refresh();
        });
      }}
    >
      {busy ? "Copying…" : "Copy last month"}
    </button>
  );
}

/**
 * The cold-start button. An empty budget asks someone to invent fifteen numbers
 * before it shows them anything; the median of what they actually spent over
 * the last three months is a better first draft than a blank column, and it is
 * editable the moment it lands.
 */
export function SuggestFromHistory({ month }: { month: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  return (
    <button
      className="btn-outline"
      disabled={busy}
      title="Fill every category with the median of the last three months"
      onClick={() => {
        setBusy(true);
        startTransition(async () => {
          await suggestBudgetAction(month);
          setBusy(false);
          router.refresh();
        });
      }}
    >
      {busy ? "Working…" : "Suggest from history"}
    </button>
  );
}
