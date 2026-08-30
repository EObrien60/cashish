#!/usr/bin/env tsx
/**
 * Prints the plan seed as SQL VALUES rows.
 *
 * Exists so the seed in a migration is generated from SEED_PLANS rather than
 * retyped beside it — the two drifting apart is how a plan ends up advertising
 * one limit and enforcing another.
 */
import { SEED_PLANS } from "../src/plans";

console.log(
  SEED_PLANS.map(
    (p) =>
      `  ('${p.code}', '${p.name}', ${p.priceCents ?? "NULL"}, '${p.cadence}', ` +
      `${p.maxUsers ?? "NULL"}, '${JSON.stringify(p.features)}', true, ${p.sortOrder})`,
  ).join(",\n"),
);
