"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { money, fmtDate } from "@/lib/format";
import { Card } from "./ui";
import { assignUnassignedAction, updateAccountAction } from "@/app/actions";
import type { AccountBalance } from "@/lib/accounts";

const KIND_LABELS: Record<string, string> = {
  current: "Current",
  savings: "Savings",
  credit_card: "Credit card",
  pocket: "Pocket",
  other: "Other",
};

export function AccountsTable({ accounts }: { accounts: AccountBalance[] }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");

  function rename(id: string) {
    const next = name.trim();
    setEditing(null);
    if (!next) return;
    start(async () => {
      await updateAccountAction(id, { name: next });
      router.refresh();
    });
  }

  return (
    <Card className="p-0 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-ink-soft bg-black/[0.02]">
            <th className="px-4 py-2 text-left font-semibold">Account</th>
            <th className="px-4 py-2 text-left font-semibold">Type</th>
            <th className="px-4 py-2 text-right font-semibold">Transactions</th>
            <th className="px-4 py-2 text-left font-semibold">Last activity</th>
            <th className="px-4 py-2 text-right font-semibold">Balance</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id} className={`border-t border-line/60 ${a.archived ? "opacity-50" : ""}`}>
              <td className="px-4 py-2 font-medium">
                {editing === a.id ? (
                  <input
                    autoFocus
                    className="input w-48"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => rename(a.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="text-left hover:underline"
                    onClick={() => {
                      setEditing(a.id);
                      setName(a.name);
                    }}
                    title="Rename"
                  >
                    {a.name}
                  </button>
                )}
                {a.inferred && (
                  <span
                    className="ml-2 rounded bg-brand/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-brand-dark"
                    title="Created from the other side of a transfer. Import its statement to see the whole account."
                  >
                    inferred
                  </span>
                )}
              </td>
              <td className="px-4 py-2 text-ink-soft">{KIND_LABELS[a.kind] ?? a.kind}</td>
              <td className="px-4 py-2 text-right tabular-nums">
                {a.transactions > 0 ? (
                  <Link href={`/transactions?account=${a.id}`} className="text-brand underline">
                    {a.transactions}
                  </Link>
                ) : (
                  <span className="text-ink-faint">—</span>
                )}
              </td>
              <td className="px-4 py-2 text-ink-soft">{fmtDate(a.lastActivity)}</td>
              <td
                className={`px-4 py-2 text-right tabular-nums font-medium ${
                  a.balance < 0 ? "text-money-out" : ""
                }`}
              >
                {money(a.balance)} <span className="text-xs text-ink-faint">{a.currency}</span>
                {a.derivedFromTransfers !== 0 && a.transactions === 0 && (
                  <div className="text-[11px] font-normal text-ink-faint">from transfers in</div>
                )}
                {a.unknownIncoming !== 0 && (
                  <div
                    className="text-[11px] font-normal text-ink-faint"
                    title="The sending account was in a different currency, so the amount that arrived is not in the statement."
                  >
                    + a currency exchange, amount unknown
                  </div>
                )}
              </td>
              <td className="px-4 py-2 text-right">
                <button
                  type="button"
                  className="text-xs text-ink-faint underline"
                  onClick={() =>
                    start(async () => {
                      await updateAccountAction(a.id, { archived: !a.archived });
                      router.refresh();
                    })
                  }
                >
                  {a.archived ? "Restore" : "Archive"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/**
 * Transactions imported before accounts existed sit on no account at all.
 * Rather than guess which one they belong to — the statement is long gone — the
 * choice is offered once, explicitly.
 */
export function AssignUnassigned({
  count,
  accounts,
}: {
  count: number;
  accounts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-[260px]">
        <h2 className="font-semibold">
          {count} transaction{count === 1 ? "" : "s"} on no account
        </h2>
        <p className="text-sm text-ink-faint mt-0.5">
          Imported before this book had accounts. Put them where they belong and every balance
          adds up again.
        </p>
      </div>
      <select
        className="input"
        value={accountId}
        onChange={(e) => setAccountId(e.target.value)}
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <button
        className="btn-primary"
        disabled={busy || !accountId}
        onClick={() => {
          setBusy(true);
          start(async () => {
            await assignUnassignedAction(accountId);
            setBusy(false);
            router.refresh();
          });
        }}
      >
        {busy ? "Assigning…" : "Assign"}
      </button>
    </div>
  );
}
