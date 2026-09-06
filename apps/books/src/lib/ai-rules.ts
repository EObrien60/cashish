import { generateObject } from "ai";
import { z } from "zod";
import { REPORT_MODEL, aiIsConfigured, describeFailure, gatewayOptions, type AiResult } from "./ai";
import { uncategorisedByMerchant } from "./insights";
import { listCategories } from "./lookups";
import { ruleMatches, listRules } from "./rules";
import { listTransactions } from "./transactions";
import { tenantId } from "@cashish/core/db";
import { round2 } from "./format";

// ---------------------------------------------------------------------------
// Proposing rules.
//
// The model is good at one thing here that no amount of pattern matching is:
// knowing that Lidl, Dunnes Stores and Asia Market are all groceries, that
// Circle K is fuel, and that Easytrip is a toll. That is world knowledge, not a
// property of the data.
//
// It is bad at the other half — knowing how many transactions a rule would
// catch and what that would cost — so it does not do that half. Every proposal
// is run through the SAME matcher the real rules use, against the real ledger,
// and the counts shown to the person are measured, not claimed.
//
// And nothing is applied. A proposal is a suggestion with its consequences
// spelled out; accepting one is a click, and it goes through the ordinary
// saveRule path. A model silently recategorising somebody's books would be
// indefensible even when it is right.
// ---------------------------------------------------------------------------

const ProposalSchema = z.object({
  proposals: z
    .array(
      z.object({
        name: z.string().describe("What a person would call this rule, e.g. 'Groceries — Lidl'."),
        matchValue: z
          .string()
          .describe(
            "The distinctive part of the description to match on. Short and unambiguous: 'Lidl', not 'Lidl 4471 Galway'.",
          ),
        direction: z.enum(["in", "out", "any"]),
        categoryName: z.string().describe("Must be exactly one of the supplied category names."),
        reason: z.string().describe("One short sentence: why this merchant is that category."),
      }),
    )
    .max(15),
});

export type RuleProposal = {
  name: string;
  matchValue: string;
  direction: "in" | "out" | "any";
  categoryId: string;
  categoryName: string;
  reason: string;
  /** Measured against the real ledger, not claimed by the model. */
  wouldMatch: number;
  wouldMatchUncategorised: number;
  amount: number;
  /** Transactions another rule already claims — accepting this may reclassify them. */
  alreadyClaimed: number;
  sample: string[];
};

export type ProposalResult = AiResult<RuleProposal[]>;

const SYSTEM = `You propose categorisation rules for a bookkeeping app.

You are given merchants that appear in a ledger with no category, and the exact
list of categories available. For each merchant worth a rule, propose one.

Rules:
- categoryName must be copied exactly from the supplied list.
- matchValue must be the shortest distinctive substring of the merchant name.
  It is matched case-insensitively against the transaction description.
- Do not propose a rule for something that will not recur, or where you cannot
  tell what the merchant is. Fewer, confident proposals are better than a long
  list of guesses.
- Direction: "out" for spending, "in" for income. Use "any" only when a merchant
  genuinely does both, like a refund-prone shop.
- Never propose a rule matching a person's name unless the category is clearly
  wages — paying a person is not automatically payroll.`;

export async function proposeRules(): Promise<ProposalResult> {
  if (!aiIsConfigured()) {
    return {
      ok: false,
      reason:
        "No AI credentials on this deployment. Set AI_GATEWAY_API_KEY, or enable AI Gateway on the Vercel project.",
    };
  }

  const [merchants, categories, existing] = await Promise.all([
    uncategorisedByMerchant(30),
    listCategories(),
    listRules(),
  ]);

  if (merchants.length === 0) {
    return { ok: false, reason: "Nothing is uncategorised — there is nothing to propose." };
  }

  let object: z.infer<typeof ProposalSchema>;
  try {
    const result = await generateObject({
      model: REPORT_MODEL,
      schema: ProposalSchema,
      system: SYSTEM,
      prompt: [
        "Uncategorised merchants (label, times seen, total spent, recurring):",
        merchants
          .map((m) => `- ${m.label} · ${m.count}× · ${m.total} · ${m.recurring ? "recurring" : "one-off"}`)
          .join("\n"),
        "",
        "Categories available:",
        categories.map((c) => `- ${c.name} (${c.kind})`).join("\n"),
        "",
        "Rules that already exist, so do not duplicate them:",
        existing.map((r) => `- ${r.matchValue}`).join("\n") || "(none)",
      ].join("\n"),
      providerOptions: gatewayOptions("rule-proposals", tenantId()),
    });
    object = result.object;
  } catch (error) {
    return describeFailure(error);
  }

  // Everything from here is measured. The model's arithmetic is never trusted,
  // and neither is its category name — one that does not exist is dropped
  // rather than guessed at.
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
  const allRows = await listTransactions({ excluded: "hide" });
  const rules = await listRules();

  const proposals: RuleProposal[] = [];
  for (const p of object.proposals) {
    const category = byName.get(p.categoryName.trim().toLowerCase());
    if (!category) continue;
    if (!p.matchValue.trim()) continue;

    const candidate = {
      id: "proposal",
      tenantId: tenantId(),
      name: p.name,
      matchField: "description" as const,
      matchType: "contains" as const,
      matchValue: p.matchValue.trim(),
      direction: p.direction,
      enabled: true,
    };

    const matched = allRows.filter((t) =>
      ruleMatches(candidate as unknown as Parameters<typeof ruleMatches>[0], t),
    );
    if (matched.length === 0) continue;

    proposals.push({
      name: p.name,
      matchValue: candidate.matchValue,
      direction: p.direction,
      categoryId: category.id,
      categoryName: category.name,
      reason: p.reason,
      wouldMatch: matched.length,
      wouldMatchUncategorised: matched.filter((t) => !t.categoryId).length,
      amount: round2(matched.reduce((acc, t) => acc + Math.abs(t.amount), 0)),
      alreadyClaimed: matched.filter((t) =>
        rules.some((r) => ruleMatches(r, t)),
      ).length,
      sample: matched.slice(0, 3).map((t) => t.description ?? ""),
    });
  }

  proposals.sort((a, b) => b.amount - a.amount);
  return { ok: true, value: proposals };
}
