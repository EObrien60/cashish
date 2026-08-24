#!/usr/bin/env tsx
/**
 * Writes the integration summary to a file.
 *
 *   npm run export:integration                       -> ./cashish-summary.json
 *   npm run export:integration -- --out ~/path.json
 *
 * The file transport exists because cashish is a desktop app: it is not running
 * on a server for something to call. Lunar reads whichever it is pointed at, and
 * both produce exactly the same payload.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { boot } from "../src/lib/boot";
import { buildIntegrationSummary, SUMMARY_VERSION } from "../src/lib/integration";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  if (index !== -1) return args[index + 1];
  return args.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
};

boot();

const summary = buildIntegrationSummary(flag("asOf"));
const out = resolve(flag("out") ?? "./cashish-summary.json");
writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

const { totals, bank } = summary;
console.log(`wrote ${out}`);
console.log(`  version ${SUMMARY_VERSION} · as of ${summary.asOf}`);
console.log(`  ${summary.customers.length} customer(s), ${summary.recurring.length} recurring schedule(s)`);
console.log(
  `  invoiced ${totals.invoiced} · received ${totals.received} · outstanding ${totals.outstanding} · overdue ${totals.overdue}`,
);
console.log(`  ${bank.unmatchedInflowCount} unmatched inflow(s), ${bank.uncategorisedCount} uncategorised transaction(s)`);
