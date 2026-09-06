"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { money } from "@/lib/format";
import { Card } from "./ui";
import { proposeRulesAction, acceptProposedRuleAction } from "@/app/actions";
import type { RuleProposal, ProposalRun } from "@/lib/ai-rules";

/**
 * Suggested rules.
 *
 * The counts beside each proposal are measured against the real ledger by the
 * same matcher the saved rules use — the model supplied the merchant-to-
 * category judgement and nothing else. Nothing is applied until it is accepted,
 * and accepting goes through the ordinary saveRule path.
 */
export function RuleProposals({
  aiAvailable,
  accounts,
}: {
  aiAvailable: boolean;
  /** Accounts with uncategorised spending, biggest first. */
  accounts: { id: string | null; name: string; uncategorised: number; amount: number }[];
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [accountKey, setAccountKey] = useState(accounts[0] ? String(accounts[0].id) : "");
  const [run, setRun] = useState<ProposalRun | null>(null);
  const proposals: RuleProposal[] | null = run ? run.proposals : null;
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-[260px] flex-1">
          <h2 className="font-semibold">Suggested rules</h2>
          <p className="text-sm text-ink-faint mt-0.5">
            Works through one account at a time, in batches, looking up merchants it is unsure
            about before suggesting anything. Nothing is applied until you accept it, and every
            count is measured against your ledger rather than guessed.
          </p>
          {accounts.length > 0 && (
            <label className="mt-2 block text-sm">
              <span className="mb-1 block text-xs font-medium text-ink-soft">Account</span>
              <select
                className="input w-auto"
                value={accountKey}
                onChange={(e) => setAccountKey(e.target.value)}
              >
                {accounts.map((a) => (
                  <option key={String(a.id)} value={String(a.id)}>
                    {a.name} — {a.uncategorised} uncategorised
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <button
          className="btn-outline"
          disabled={busy || !aiAvailable}
          title={aiAvailable ? undefined : "No AI credentials on this deployment"}
          onClick={() => {
            setBusy(true);
            setError(null);
            setRun(null);
            start(async () => {
              const r = await proposeRulesAction(accountKey === "null" ? null : accountKey);
              if (r.ok) setRun(r.value);
              else setError(r.reason);
              setBusy(false);
            });
          }}
        >
          {busy ? "Reading the account…" : "Suggest rules"}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-money-out">{error}</p>}

      {run && run.proposals.length === 0 && (
        <p className="mt-3 text-sm text-ink-faint">
          Looked at {run.examined} merchant{run.examined === 1 ? "" : "s"} on {run.accountName} and
          found nothing it could identify confidently.
          {run.remaining > 0 && ` ${run.remaining} smaller ones were not reached — run it again to continue.`}
        </p>
      )}

      {run && run.proposals.length > 0 && (
        <p className="mt-3 text-sm text-ink-faint">
          {run.accountName}: {run.examined} merchant{run.examined === 1 ? "" : "s"} examined in{" "}
          {run.batches} batch{run.batches === 1 ? "" : "es"}
          {run.remaining > 0 && `, ${run.remaining} still to go — run it again to continue`}.
        </p>
      )}

      {proposals && proposals.length > 0 && (
        <div className="mt-4 space-y-2">
          {proposals.map((p) => {
            const done = accepted.has(p.matchValue);
            return (
              <div
                key={p.matchValue}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3"
              >
                <div className="min-w-[220px] flex-1">
                  <div className="font-medium">
                    {p.name}{" "}
                    <span className="text-xs font-normal text-ink-faint">
                      → {p.categoryName}
                    </span>
                  </div>
                  <div className="text-xs text-ink-faint">
                    matches <code>{p.matchValue}</code> · {p.reason}
                  </div>
                  <div className="mt-1 text-xs text-ink-soft">
                    {p.wouldMatch} transaction{p.wouldMatch === 1 ? "" : "s"} ·{" "}
                    {money(p.amount)} · {p.wouldMatchUncategorised} of them uncategorised
                    {p.alreadyClaimed > 0 && (
                      <span className="text-amber-700">
                        {" "}
                        · {p.alreadyClaimed} already matched by another rule
                      </span>
                    )}
                  </div>
                </div>
                <button
                  className="btn-primary"
                  disabled={done}
                  onClick={() => {
                    setAccepted((s) => new Set(s).add(p.matchValue));
                    start(async () => {
                      await acceptProposedRuleAction({
                        name: p.name,
                        matchValue: p.matchValue,
                        direction: p.direction,
                        categoryId: p.categoryId,
                      });
                      router.refresh();
                    });
                  }}
                >
                  {done ? "Added" : "Add rule"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
