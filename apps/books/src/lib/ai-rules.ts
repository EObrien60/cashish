import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { and, eq, gte, ilike, lt, sql } from "drizzle-orm";
import { db, schema, tenantId, type CategoryRule } from "@cashish/core/db";
import { REPORT_MODEL, aiIsConfigured, describeFailure, gatewayOptions, type AiResult } from "./ai";
import { merchantLabel } from "./insights";
import { listCategories } from "./lookups";
import { ruleMatches, listRules } from "./rules";
import { notExcluded } from "./transactions";
import { round2 } from "./format";

const { transactions } = schema;

// ---------------------------------------------------------------------------
// Proposing rules, over a ledger too big to hand to a model.
//
// Twelve thousand transactions is the shape of a real book, and it changes the
// design entirely. Everything expensive is done in Postgres and in this file:
// the rows are clustered into merchants, the merchants are ranked, and the
// model is shown a page of them at a time. It never sees a transaction.
//
// Within a batch it gets TOOLS rather than a single answer, because the useful
// question is often "what else looks like this?" — "Circle K" and "Circle K Gas
// Station" are one merchant, "SPAR Food & Fuel" might be either, and the only
// way to tell is to look. So it can search, it can dry-run a rule and see
// exactly what that rule would catch, and it proposes only once it has.
//
// Scoped to ONE ACCOUNT at a time, because a rule that makes sense on a
// personal credit card is often wrong on a business current account: the same
// "Circle K" is fuel for one and a client lunch for the other. Proposing across
// a whole book mixes them.
//
// And every number the person sees is measured here, by the same matcher the
// saved rules use. The model supplies world knowledge — that Lidl is groceries
// and Easytrip is a toll — and nothing else.
// ---------------------------------------------------------------------------

export type RuleProposal = {
  name: string;
  matchValue: string;
  direction: "in" | "out" | "any";
  categoryId: string;
  categoryName: string;
  reason: string;
  accountId: string | null;
  wouldMatch: number;
  wouldMatchUncategorised: number;
  amount: number;
  alreadyClaimed: number;
  sample: string[];
};

export type ProposalRun = {
  proposals: RuleProposal[];
  /** Merchant clusters looked at, and how many are left for a later run. */
  examined: number;
  remaining: number;
  batches: number;
  accountName: string;
};

export type ProposalResult = AiResult<ProposalRun>;

type Cluster = {
  label: string;
  count: number;
  total: number;
  months: number;
  sample: string[];
};

const ofAccount = (accountId: string | null) =>
  accountId
    ? eq(transactions.accountId, accountId)
    : sql`${transactions.accountId} is null`;

/**
 * Every uncategorised merchant on one account, biggest first.
 *
 * Done in SQL over the whole account rather than by pulling rows into memory,
 * because "the whole account" is the twelve thousand.
 */
async function clustersFor(accountId: string | null): Promise<Cluster[]> {
  const rows = await db
    .select({
      description: transactions.description,
      amount: transactions.amount,
      bookedDate: transactions.bookedDate,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tenantId()),
        notExcluded(),
        sql`${transactions.categoryId} is null`,
        ofAccount(accountId),
      ),
    );

  const map = new Map<string, { count: number; total: number; months: Set<string>; sample: string[] }>();
  for (const r of rows) {
    const label = merchantLabel(r.description ?? "");
    const c = map.get(label) ?? { count: 0, total: 0, months: new Set<string>(), sample: [] };
    c.count += 1;
    c.total += Math.abs(r.amount);
    c.months.add(r.bookedDate.slice(0, 7));
    if (c.sample.length < 3 && r.description) c.sample.push(r.description);
    map.set(label, c);
  }

  return [...map.entries()]
    .map(([label, c]) => ({
      label,
      count: c.count,
      total: round2(c.total),
      months: c.months.size,
      sample: c.sample,
    }))
    .sort((a, b) => b.total - a.total);
}

/** Postgres LIKE metacharacters, so a merchant called "50%" searches for itself. */
const likeEscape = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * What a candidate rule would actually catch on this account. Never guessed.
 *
 * The match runs in Postgres. It used to select every non-excluded row on the
 * account and filter in JavaScript, which on a twelve-thousand-transaction book
 * meant hauling the whole ledger across the wire on EVERY tool call the model
 * made — and it makes several per merchant. The run never finished. ILIKE
 * '%value%' is exactly what the JS matcher does for a case-insensitive
 * "contains", so the counts are unchanged; only the matched rows come back now,
 * and `alreadyClaimed` still uses the real matcher over that much smaller set.
 */
async function measure(
  accountId: string | null,
  matchValue: string,
  direction: "in" | "out" | "any",
  rules: CategoryRule[],
) {
  const matched = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tenantId()),
        notExcluded(),
        ofAccount(accountId),
        ilike(transactions.description, `%${likeEscape(matchValue)}%`),
        // Mirrors ruleMatches: "in" keeps amount >= 0, "out" keeps amount < 0.
        direction === "in" ? gte(transactions.amount, 0) : undefined,
        direction === "out" ? lt(transactions.amount, 0) : undefined,
      ),
    );

  return {
    wouldMatch: matched.length,
    wouldMatchUncategorised: matched.filter((t) => !t.categoryId).length,
    amount: round2(matched.reduce((acc, t) => acc + Math.abs(t.amount), 0)),
    alreadyClaimed: matched.filter((t) => rules.some((r) => ruleMatches(r, t))).length,
    sample: matched.slice(0, 3).map((t) => t.description ?? ""),
  };
}

const SYSTEM = `You write categorisation rules for one bank account in a bookkeeping app.

You are shown a batch of merchants that appear on this account with no category,
largest spend first. For each one you recognise, add a rule.

You have tools. Use them rather than assuming:
- findSimilar, when a name is ambiguous or you suspect variants of it exist
  elsewhere on the account ("Circle K" vs "Circle K Gas Station").
- checkRule, to see exactly what a match value would catch before proposing it.
  A match value that is too broad will catch things it should not; this is how
  you find that out.
- proposeRule records a rule and returns what it will catch. It rejects a
  category that does not exist and a match value that catches nothing.

Match values are the shortest distinctive substring — "Lidl", not
"Lidl 4471 Galway". They are matched case-insensitively on the description.

Recognisable merchants are worth a rule even from one transaction, because they
recur: supermarkets, fuel, tolls, chains, utilities, well-known software.

Do NOT propose rules for:
- transfers between someone's own accounts ("To EUR", "Transfer to Savings") —
  those are not spending and a rule would file them as if they were;
- a person's name, unless the category is clearly wages;
- anything you cannot identify. Say nothing rather than guess.

When you have been through the batch, stop and give a one-line summary.`;

export async function proposeRulesForAccount(input: {
  accountId: string | null;
  batchSize?: number;
  maxBatches?: number;
}): Promise<ProposalResult> {
  if (!aiIsConfigured()) {
    return {
      ok: false,
      reason:
        "No AI credentials on this deployment. Set AI_GATEWAY_API_KEY, or enable AI Gateway on the Vercel project.",
    };
  }

  const tid = tenantId();
  const [account] = input.accountId
    ? await db
        .select()
        .from(schema.accounts)
        .where(and(eq(schema.accounts.tenantId, tid), eq(schema.accounts.id, input.accountId)))
    : [];
  const accountName = account?.name ?? "Transactions with no account";

  const clusters = await clustersFor(input.accountId);
  if (clusters.length === 0) {
    return { ok: false, reason: `Nothing is uncategorised on ${accountName}.` };
  }

  const categories = await listCategories();
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
  const existing = await listRules();

  const batchSize = Math.min(40, Math.max(5, input.batchSize ?? 20));
  const maxBatches = Math.min(10, Math.max(1, input.maxBatches ?? 3));

  const proposals: RuleProposal[] = [];
  const seen = new Set<string>();
  let examined = 0;
  let batches = 0;

  for (let i = 0; i < clusters.length && batches < maxBatches; i += batchSize) {
    const batch = clusters.slice(i, i + batchSize);
    batches += 1;
    examined += batch.length;

    const tools = {
      findSimilar: tool({
        description:
          "Search this account's transactions for descriptions containing some text. Use it to find variants of a merchant name, or to check what an ambiguous name really is.",
        inputSchema: z.object({
          text: z.string().describe("Substring to look for, case-insensitive."),
        }),
        execute: async ({ text }) => {
          const found = await measure(input.accountId, text, "any", existing);
          return {
            matches: found.wouldMatch,
            uncategorised: found.wouldMatchUncategorised,
            totalAmount: found.amount,
            examples: found.sample,
          };
        },
      }),
      checkRule: tool({
        description:
          "Dry run: what would a rule with this match value catch on this account? Nothing is saved.",
        inputSchema: z.object({
          matchValue: z.string(),
          direction: z.enum(["in", "out", "any"]),
        }),
        execute: async ({ matchValue, direction }) =>
          measure(input.accountId, matchValue, direction, existing),
      }),
      proposeRule: tool({
        description:
          "Record a proposed rule. Returns what it would catch, or an error explaining why it was rejected.",
        inputSchema: z.object({
          name: z.string(),
          matchValue: z.string(),
          direction: z.enum(["in", "out", "any"]),
          categoryName: z.string(),
          reason: z.string(),
        }),
        execute: async (p) => {
          const category = byName.get(p.categoryName.trim().toLowerCase());
          if (!category) {
            return { error: `No category called "${p.categoryName}". Use one from the list.` };
          }
          const value = p.matchValue.trim();
          if (!value) return { error: "matchValue is empty." };
          if (seen.has(value.toLowerCase())) {
            return { error: `Already proposed a rule matching "${value}".` };
          }

          const found = await measure(input.accountId, value, p.direction, existing);
          if (found.wouldMatch === 0) {
            return { error: `"${value}" matches nothing on this account. Try findSimilar first.` };
          }

          seen.add(value.toLowerCase());
          proposals.push({
            name: p.name,
            matchValue: value,
            direction: p.direction,
            categoryId: category.id,
            categoryName: category.name,
            reason: p.reason,
            accountId: input.accountId,
            ...found,
          });
          return { recorded: true, ...found };
        },
      }),
    };

    try {
      await generateText({
        model: REPORT_MODEL,
        system: SYSTEM,
        tools,
        // Enough turns to look something up, check it and propose it, several
        // times over — and a hard ceiling, because an agent with a budget is
        // the only kind worth deploying.
        stopWhen: stepCountIs(batch.length + 12),
        prompt: [
          `Account: ${accountName}`,
          "",
          "Uncategorised merchants on it (label · times seen · total · months active):",
          batch
            .map((c) => `- ${c.label} · ${c.count}× · ${c.total} · ${c.months} month(s)`)
            .join("\n"),
          "",
          "Categories available (use these names exactly):",
          categories.map((c) => `- ${c.name} (${c.kind})`).join("\n"),
          "",
          "Rules that already exist, so do not duplicate them:",
          existing.map((r) => `- ${r.matchValue}`).join("\n") || "(none)",
        ].join("\n"),
        providerOptions: gatewayOptions("rule-proposals", tid),
      });
    } catch (error) {
      // A batch failing part-way is not a reason to lose the batches that
      // worked; report what was gathered and why it stopped.
      if (proposals.length === 0) return describeFailure(error);
      break;
    }
  }

  proposals.sort((a, b) => b.amount - a.amount);
  return {
    ok: true,
    value: {
      proposals,
      examined,
      remaining: Math.max(0, clusters.length - examined),
      batches,
      accountName,
    },
  };
}

/** Accounts that have something to propose rules for, biggest first. */
export async function accountsNeedingRules(): Promise<
  { id: string | null; name: string; uncategorised: number; amount: number }[]
> {
  const tid = tenantId();
  const rows = await db
    .select({
      accountId: transactions.accountId,
      n: sql<number>`count(*)`,
      total: sql<number>`coalesce(sum(abs(${transactions.amount})), 0)`,
    })
    .from(transactions)
    .where(
      and(eq(transactions.tenantId, tid), notExcluded(), sql`${transactions.categoryId} is null`),
    )
    .groupBy(transactions.accountId);

  const accounts = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.tenantId, tid));
  const nameOf = new Map(accounts.map((a) => [a.id, a.name]));

  return rows
    .map((r) => ({
      id: r.accountId,
      name: r.accountId ? (nameOf.get(r.accountId) ?? "Unknown account") : "No account",
      uncategorised: Number(r.n),
      amount: round2(Number(r.total)),
    }))
    .sort((a, b) => b.amount - a.amount);
}
