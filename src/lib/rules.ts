import { db, schema } from "@/db/client";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { uid } from "./id";
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
};

export function listRules() {
  return db.select().from(categoryRules).orderBy(asc(categoryRules.sortOrder)).all();
}

export function saveRule(input: RuleInput) {
  if (input.id) {
    const { id, ...rest } = input;
    db.update(categoryRules).set(rest).where(eq(categoryRules.id, id)).run();
    return;
  }
  const maxOrder =
    (db
      .select({ m: sql<number>`COALESCE(MAX(${categoryRules.sortOrder}), -1)` })
      .from(categoryRules)
      .get()?.m ?? -1) + 1;
  const { id: _ignore, ...rest } = input;
  db.insert(categoryRules)
    .values({ id: uid(), sortOrder: maxOrder, ...rest })
    .run();
}

export function deleteRule(id: string) {
  db.delete(categoryRules).where(eq(categoryRules.id, id)).run();
}

export function reorderRule(id: string, direction: "up" | "down") {
  const rules = listRules();
  const idx = rules.findIndex((r) => r.id === id);
  if (idx < 0) return;
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= rules.length) return;
  const a = rules[idx];
  const b = rules[swapWith];
  db.transaction((trx) => {
    trx.update(categoryRules).set({ sortOrder: b.sortOrder }).where(eq(categoryRules.id, a.id)).run();
    trx.update(categoryRules).set({ sortOrder: a.sortOrder }).where(eq(categoryRules.id, b.id)).run();
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

export type ApplyResult = { matched: number; updated: number };

// Apply rules to a set of transactions. By default only touches uncategorised
// ones (so manual categorisations are never overwritten).
export function applyRulesToTransactions(
  txs: Transaction[],
  opts: { onlyUncategorized?: boolean } = { onlyUncategorized: true },
): ApplyResult {
  const rules = listRules().filter((r) => r.enabled);
  if (rules.length === 0) return { matched: 0, updated: 0 };

  let matched = 0;
  let updated = 0;
  const applyCounts = new Map<string, number>();

  db.transaction((trx) => {
    for (const t of txs) {
      if (opts.onlyUncategorized && t.categoryId) continue;
      const rule = firstMatch(rules, t);
      if (!rule) continue;
      matched++;
      trx
        .update(transactions)
        .set({
          categoryId: rule.categoryId ?? null,
          vatRateId: rule.vatRateId ?? null,
        })
        .where(eq(transactions.id, t.id))
        .run();
      updated++;
      applyCounts.set(rule.id, (applyCounts.get(rule.id) ?? 0) + 1);
    }
    for (const [ruleId, n] of applyCounts) {
      trx
        .update(categoryRules)
        .set({ timesApplied: sql`${categoryRules.timesApplied} + ${n}` })
        .where(eq(categoryRules.id, ruleId))
        .run();
    }
  });

  return { matched, updated };
}

// Sweep all currently-uncategorised transactions.
export function applyRulesToUncategorized(): ApplyResult {
  const txs = db
    .select()
    .from(transactions)
    .where(isNull(transactions.categoryId))
    .all();
  return applyRulesToTransactions(txs, { onlyUncategorized: true });
}
