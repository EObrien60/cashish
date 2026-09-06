"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { money } from "@/lib/format";
import { Card } from "./ui";
import { proposeRulesAction, acceptProposedRuleAction } from "@/app/actions";
import type { RuleProposal } from "@/lib/ai-rules";

/**
 * Suggested rules.
 *
 * The counts beside each proposal are measured against the real ledger by the
 * same matcher the saved rules use — the model supplied the merchant-to-
 * category judgement and nothing else. Nothing is applied until it is accepted,
 * and accepting goes through the ordinary saveRule path.
 */
export function RuleProposals({ aiAvailable }: { aiAvailable: boolean }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [proposals, setProposals] = useState<RuleProposal[] | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Suggested rules</h2>
          <p className="text-sm text-ink-faint mt-0.5">
            Looks at what is uncategorised and proposes rules for it. Nothing is applied until you
            accept it, and the counts are measured, not guessed.
          </p>
        </div>
        <button
          className="btn-outline"
          disabled={busy || !aiAvailable}
          title={aiAvailable ? undefined : "No AI credentials on this deployment"}
          onClick={() => {
            setBusy(true);
            setError(null);
            start(async () => {
              const r = await proposeRulesAction();
              if (r.ok) setProposals(r.value);
              else setError(r.reason);
              setBusy(false);
            });
          }}
        >
          {busy ? "Looking…" : "Suggest rules"}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-money-out">{error}</p>}

      {proposals?.length === 0 && (
        <p className="mt-3 text-sm text-ink-faint">
          Nothing worth a rule — what is left uncategorised looks like one-offs.
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
