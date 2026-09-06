"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { moneyIn, fmtDate } from "@/lib/format";
import { Card } from "./ui";
import {
  assignUnassignedAction,
  updateAccountAction,
  recomputeAccountsAction,
  mergeAccountsAction,
} from "@/app/actions";
import type { AccountBalance } from "@/lib/accounts";
import { ACCOUNT_KIND_LABELS, isLiability } from "@/lib/account-kinds";

export function AccountsTable({
  accounts,
  all,
}: {
  accounts: AccountBalance[];
  /** Every account in the book — merge targets can be in another currency block. */
  all?: AccountBalance[];
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [merging, setMerging] = useState<string | null>(null);
  const candidates = all ?? accounts;

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
    <Card className="p-0 overflow-x-auto">
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
                  <>
                    <Link href={`/accounts/${a.id}`} className="hover:underline">
                      {a.name}
                    </Link>
                    <button
                      type="button"
                      className="ml-2 text-[10px] uppercase tracking-wide text-ink-faint underline"
                      onClick={() => {
                        setEditing(a.id);
                        setName(a.name);
                      }}
                    >
                      rename
                    </button>
                  </>
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
              <td className="px-4 py-2 text-ink-soft">{ACCOUNT_KIND_LABELS[a.kind] ?? a.kind}</td>
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
                  (isLiability(a.kind) ? a.balance < 0 : a.balance < 0) ? "text-money-out" : ""
                }`}
              >
                {/* A card at -260 is 260 owed, and saying so is the difference
                    between a number and an answer. */}
                {isLiability(a.kind) && a.balance < 0
                  ? `${moneyIn(-a.balance, a.currency)} owed`
                  : moneyIn(a.balance, a.currency)}
                {isLiability(a.kind) && a.inferred && a.balance > 0 && (
                  <div className="text-[11px] font-normal text-ink-faint">
                    paid in; the card&rsquo;s own statement is not imported
                  </div>
                )}
                {a.derivedFromTransfers !== 0 && a.transactions === 0 && !isLiability(a.kind) && (
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
              <td className="px-4 py-2 text-right whitespace-nowrap">
                {merging === a.id ? (
                  <select
                    autoFocus
                    className="input w-44 text-xs"
                    defaultValue=""
                    onBlur={() => setMerging(null)}
                    onChange={(e) => {
                      const into = e.target.value;
                      setMerging(null);
                      if (!into) return;
                      start(async () => {
                        await mergeAccountsAction(a.id, into);
                        router.refresh();
                      });
                    }}
                  >
                    <option value="">Merge into…</option>
                    {candidates
                      .filter((c) => c.id !== a.id)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                ) : (
                  <>
                    <button
                      type="button"
                      className="text-xs text-ink-faint underline"
                      title="If this is the same account as another one under a different name"
                      onClick={() => setMerging(a.id)}
                    >
                      Merge
                    </button>
                    <button
                      type="button"
                      className="ml-3 text-xs text-ink-faint underline"
                      onClick={() =>
                        start(async () => {
                          await updateAccountAction(a.id, { archived: !a.archived });
                          router.refresh();
                        })
                      }
                    >
                      {a.archived ? "Restore" : "Archive"}
                    </button>
                  </>
                )}
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

type RecomputeResult = {
  assigned: number;
  detected: number;
  paired: number;
  accountsCreated: string[];
};

function resultSentence(r: RecomputeResult): string {
  const parts: string[] = [];
  if (r.assigned) parts.push(`${r.assigned} transaction${r.assigned === 1 ? "" : "s"} assigned`);
  if (r.detected) parts.push(`${r.detected} internal transfer${r.detected === 1 ? "" : "s"} found`);
  if (r.paired) parts.push(`${r.paired} matched to their other half`);
  if (r.accountsCreated.length) parts.push(`created ${r.accountsCreated.join(", ")}`);
  return parts.length ? `${parts.join(", ")}.` : "Nothing to change — everything was already sorted.";
}

/**
 * The way in for a book that predates accounts.
 *
 * Its transactions sit on no account and have never been scanned for
 * transfers, and until one account exists there is nothing to assign them to —
 * so naming that account and doing the whole job is one step, not three.
 */
export function SetUpFromTransactions({ transactionCount }: { transactionCount: number }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [name, setName] = useState("Main");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RecomputeResult | null>(null);

  return (
    <div>
      <h2 className="font-semibold">Set up accounts from what you already have</h2>
      <p className="text-sm text-ink-faint mt-0.5 mb-3">
        This book has {transactionCount} transaction{transactionCount === 1 ? "" : "s"} and no
        accounts — they were imported before accounts existed. Name the account they came from and
        cashish will put them on it, then look through them for transfers between your own
        accounts, creating any it finds on the far side.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[200px]">
          <span className="mb-1 block text-xs font-medium text-ink-soft">Account name</span>
          <input
            className="input w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Main"
          />
        </label>
        <button
          className="btn-primary"
          disabled={busy || !name.trim()}
          onClick={() => {
            setBusy(true);
            start(async () => {
              const r = await recomputeAccountsAction({ createAccount: name.trim() });
              setResult(r);
              setBusy(false);
              router.refresh();
            });
          }}
        >
          {busy ? "Working…" : "Set up"}
        </button>
      </div>
      {result && <p className="mt-3 text-sm text-brand">{resultSentence(result)}</p>}
    </div>
  );
}

/**
 * Re-runs the scan over the whole ledger.
 *
 * Wanted after importing a second account, after renaming one, or simply
 * because a transfer was missed: detection can only recognise "To Savings" once
 * it knows what your accounts are called, so the answer changes as the book
 * fills in.
 */
export function RescanTransfers() {
  const router = useRouter();
  const [, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RecomputeResult | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        className="btn-outline"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          start(async () => {
            const r = await recomputeAccountsAction();
            setResult(r);
            setBusy(false);
            router.refresh();
          });
        }}
      >
        {busy ? "Scanning…" : "Re-scan for transfers"}
      </button>
      <span className="text-sm text-ink-faint">
        {result ? resultSentence(result) : "Looks through every transaction for moves between your own accounts."}
      </span>
    </div>
  );
}
