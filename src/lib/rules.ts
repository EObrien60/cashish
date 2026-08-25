import { db, first, schema } from "@/db/client";
import { tenantId } from "@/db/context";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { uid } from "./id";
import { notExcluded } from "./transactions";
import type { CategoryRule, Transaction } from "@/db/schema";

const { categoryRules, transactions, categories } = schema;

export type RuleInput = {
  id?: string;
  name: string;
  matchField: string; // description|reference|payer|mcc|any
  matchType: string; // contains|equals|startsWith|regex
  matchValue: string;
  direction: string; // any|in|out
  categoryId: string | null;
  vatRateId: string | null;
  enabled: boolean;
  /**
   * Optional: also attach this employee to whatever the rule matches.
   *
   * This is what makes linking a year of salary payments to a person one action
   * rather than a hundred. The rules that recognise "TO XINYU ZHANG" already
   * exist to categorise the payment; naming the employee on the same rule means
   * applying it backfills the history too.
   */
  employeeId?: string | null;
};

const ofTenant = () => eq(categoryRules.tenantId, tenantId());

export async function listRules() {
  return db
    .select()
    .from(categoryRules)
    .where(ofTenant())
    .orderBy(asc(categoryRules.sortOrder));
}

export async function saveRule(input: RuleInput) {
  if (input.id) {
    const { id, ...rest } = input;
    await db
      .update(categoryRules)
      .set(rest)
      .where(and(ofTenant(), eq(categoryRules.id, id)));
    return;
  }
  const maxRow = first(
    await db
      .select({ m: sql<number>`COALESCE(MAX(${categoryRules.sortOrder}), -1)` })
      .from(categoryRules)
      .where(ofTenant())
      .limit(1),
  );
  const maxOrder = Number(maxRow?.m ?? -1) + 1;
  const { id: _ignore, ...rest } = input;
  await db
    .insert(categoryRules)
    .values({ id: uid(), tenantId: tenantId(), sortOrder: maxOrder, ...rest });
}

export async function deleteRule(id: string) {
  await db.delete(categoryRules).where(and(ofTenant(), eq(categoryRules.id, id)));
}

export async function reorderRule(id: string, direction: "up" | "down") {
  const rules = await listRules();
  const idx = rules.findIndex((r) => r.id === id);
  if (idx < 0) return;
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= rules.length) return;
  const a = rules[idx];
  const b = rules[swapWith];
  await db.transaction(async (trx) => {
    await trx
      .update(categoryRules)
      .set({ sortOrder: b.sortOrder })
      .where(and(ofTenant(), eq(categoryRules.id, a.id)));
    await trx
      .update(categoryRules)
      .set({ sortOrder: a.sortOrder })
      .where(and(ofTenant(), eq(categoryRules.id, b.id)));
  });
}

function fieldText(t: Pick<Transaction, "description" | "reference" | "payer" | "mcc">, field: string): string {
  switch (field) {
    case "description":
      return t.description ?? "";
    case "reference":
      return t.reference ?? "";
    case "payer":
      return t.payer ?? "";
    case "mcc":
      return t.mcc ?? "";
    case "any":
      return [t.description, t.reference, t.payer, t.mcc].filter(Boolean).join(" ");
    default:
      return "";
  }
}

export function ruleMatches(rule: CategoryRule, t: Transaction): boolean {
  if (!rule.enabled) return false;
  if (rule.direction === "in" && t.amount < 0) return false;
  if (rule.direction === "out" && t.amount >= 0) return false;
  const hay = fieldText(t, rule.matchField).toLowerCase();
  const needle = (rule.matchValue ?? "").toLowerCase().trim();
  if (!needle) return false;
  switch (rule.matchType) {
    case "equals":
      return hay === needle;
    case "startsWith":
      return hay.startsWith(needle);
    case "regex":
      try {
        return new RegExp(rule.matchValue, "i").test(fieldText(t, rule.matchField));
      } catch {
        return false;
      }
    case "contains":
    default:
      return hay.includes(needle);
  }
}

// Find the first matching rule (rules are pre-sorted by priority).
export function firstMatch(rules: CategoryRule[], t: Transaction): CategoryRule | null {
  for (const r of rules) if (ruleMatches(r, t)) return r;
  return null;
}

export type ApplyResult = {
  matched: number;
  updated: number;
  /**
   * How many already had a *different* category and were overwritten. Reported separately
   * because that is the destructive half of applying rules, and the number a person wants
   * to see before trusting it.
   */
  recategorised: number;
};

// Apply rules to a set of transactions. By default only touches uncategorised
// ones (so manual categorisations are never overwritten).
export async function applyRulesToTransactions(
  txs: Transaction[],
  opts: { onlyUncategorized?: boolean } = { onlyUncategorized: true },
): Promise<ApplyResult> {
  const tid = tenantId();
  const rules = (await listRules()).filter((r) => r.enabled);
  if (rules.length === 0) return { matched: 0, updated: 0, recategorised: 0 };

  let matched = 0;
  let updated = 0;
  let recategorised = 0;
  const applyCounts = new Map<string, number>();

  await db.transaction(async (trx) => {
    for (const t of txs) {
      if (opts.onlyUncategorized && t.categoryId) continue;
      // An excluded transaction is out of the books, so no rule gets to categorise it.
      if (t.excluded) continue;
      const rule = firstMatch(rules, t);
      if (!rule) continue;
      matched++;
      const before = t.categoryId ?? null;
      const after = rule.categoryId ?? null;
      if (before !== null && before !== after) recategorised++;
      await trx
        .update(transactions)
        .set({
          categoryId: rule.categoryId ?? null,
          vatRateId: rule.vatRateId ?? null,
          // Only set when the rule names someone. A rule with no employee must
          // not clear one that was attached by hand.
          ...(rule.employeeId ? { employeeId: rule.employeeId } : {}),
        })
        .where(and(eq(transactions.tenantId, tid), eq(transactions.id, t.id)));
      updated++;
      applyCounts.set(rule.id, (applyCounts.get(rule.id) ?? 0) + 1);
    }
    for (const [ruleId, n] of applyCounts) {
      // The only raw SQL left in the query layer: an atomic increment, with no
      // table reference of its own to scope. The surrounding where() carries the
      // tenant filter.
      await trx
        .update(categoryRules)
        .set({ timesApplied: sql`${categoryRules.timesApplied} + ${n}` })
        .where(and(eq(categoryRules.tenantId, tid), eq(categoryRules.id, ruleId)));
    }
  });

  return { matched, updated, recategorised };
}

// Sweep all currently-uncategorised transactions.
export async function applyRulesToUncategorized(): Promise<ApplyResult> {
  const txs = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tenantId()),
        isNull(transactions.categoryId),
        notExcluded(),
      ),
    );
  return applyRulesToTransactions(txs, { onlyUncategorized: true });
}

/**
 * Re-applies every enabled rule to every transaction, including ones that already have a
 * category.
 *
 * This is what "apply rules" has to do to be useful: a rule you just corrected is worth
 * nothing if it cannot reach the transactions it previously got wrong. Only rows a rule
 * actually matches are touched — a category set by hand that no rule has an opinion about
 * survives untouched, and excluded rows are skipped entirely.
 */
export async function applyRulesToAll(): Promise<ApplyResult> {
  const txs = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.tenantId, tenantId()), notExcluded()));
  return applyRulesToTransactions(txs, { onlyUncategorized: false });
}
