/**
 * Rule application.
 *
 * The behaviour that matters: changing a rule and re-applying has to reach transactions
 * that already have a category, or correcting a rule silently does nothing to the
 * history it was meant to fix.
 *
 *   npm test
 *
 * Runs against a scratch database. DATABASE_URL is set by the npm script, and the client
 * refuses nothing on its own, so the guard is here: never point this at the real book.
 */
import assert from "node:assert/strict";
import test from "node:test";

const url = process.env.DATABASE_URL ?? "";
if (!/scratch|test/i.test(url)) {
  throw new Error(`refusing to run against ${url || "the default database"} — use npm test`);
}

// Required, not imported: the guard above has to run before the client opens anything.
/* eslint-disable @typescript-eslint/no-require-imports */
const { db, schema } = require("../src/db/client") as typeof import("../src/db/client");
const { boot } = require("../src/lib/boot") as typeof import("../src/lib/boot");
const {
  saveRule,
  listRules,
  deleteRule,
  applyRulesToUncategorized,
  applyRulesToAll,
} = require("../src/lib/rules") as typeof import("../src/lib/rules");
const { uid } = require("../src/lib/id") as typeof import("../src/lib/id");

boot();

const reset = () => {
  db.delete(schema.transactions).run();
  for (const rule of listRules()) deleteRule(rule.id);
};

const addTx = (description: string, categoryId: string | null = null) => {
  const id = uid();
  db.insert(schema.transactions)
    .values({ id, bookedDate: "2026-07-01", amount: -10, description, categoryId, importBatch: uid() })
    .run();
  return id;
};

const categoryOf = (id: string) =>
  db.select().from(schema.transactions).all().find((t) => t.id === id)?.categoryId ?? null;

test("re-applying a corrected rule reaches transactions that already have a category", () => {
  reset();
  // The scenario: a rule put these under the wrong category, and the rule is now fixed.
  const wrong = addTx("HETZNER ONLINE GMBH", "cat-misc");
  saveRule({
    name: "Hetzner",
    matchField: "description",
    matchType: "contains",
    matchValue: "HETZNER",
    direction: "any",
    categoryId: "cat-software",
    vatRateId: null,
    enabled: true,
  });

  // Applying to uncategorised only leaves the mistake in place — which is the bug.
  applyRulesToUncategorized();
  assert.equal(categoryOf(wrong), "cat-misc", "an already-categorised row is not reached");

  const result = applyRulesToAll();
  assert.equal(categoryOf(wrong), "cat-software", "re-applying must correct it");
  assert.equal(result.updated, 1);
  assert.equal(result.recategorised, 1, "reported separately, because it overwrote something");
});

test("a category no rule matches is left alone", () => {
  reset();
  // Categorised by hand, and no rule has an opinion about it. It must survive.
  const manual = addTx("SOMETHING ONLY A HUMAN UNDERSTOOD", "cat-professional");
  const ruled = addTx("HETZNER ONLINE GMBH");
  saveRule({
    name: "Hetzner",
    matchField: "description",
    matchType: "contains",
    matchValue: "HETZNER",
    direction: "any",
    categoryId: "cat-software",
    vatRateId: null,
    enabled: true,
  });

  const result = applyRulesToAll();
  assert.equal(categoryOf(manual), "cat-professional", "no rule matched it, so nothing touched it");
  assert.equal(categoryOf(ruled), "cat-software");
  assert.equal(result.updated, 1);
  assert.equal(result.recategorised, 0, "nothing was overwritten");
});

test("a disabled rule stops claiming transactions", () => {
  reset();
  const tx = addTx("HETZNER ONLINE GMBH", "cat-software");
  saveRule({
    name: "Hetzner",
    matchField: "description",
    matchType: "contains",
    matchValue: "HETZNER",
    direction: "any",
    categoryId: "cat-software",
    vatRateId: null,
    enabled: false,
  });

  const result = applyRulesToAll();
  assert.equal(result.updated, 0);
  assert.equal(categoryOf(tx), "cat-software", "disabling a rule does not clear what it set");
});
