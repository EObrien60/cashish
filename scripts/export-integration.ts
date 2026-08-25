#!/usr/bin/env tsx
/**
 * Writes one tenant's integration summary to a file.
 *
 *   npm run export:integration -- --tenant <slug>
 *   npm run export:integration -- --tenant <slug> --out ~/path.json
 *
 * The HTTP endpoint (GET /api/integration/summary, authenticated with an API
 * key) is the normal transport now that cashish is a service. This exists for
 * running the same payload out to a file by hand — the two produce identical
 * output.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInTenant } from "../src/db/context";
import { findTenantBySlug } from "../src/db/seed";
import { pool } from "../src/db/client";
import { buildIntegrationSummary, SUMMARY_VERSION } from "../src/lib/integration";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  if (index !== -1) return args[index + 1];
  return args.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
};

const slug = flag("tenant");
if (!slug) {
  console.error("--tenant <slug> is required: a summary is always about one tenant's books.");
  process.exit(1);
}
const tenant = await findTenantBySlug(slug);
if (!tenant) {
  console.error(`no tenant with slug "${slug}".`);
  process.exit(1);
}

const summary = await runInTenant(
  { tenantId: tenant.id, role: "owner", actor: "export-integration" },
  () => buildIntegrationSummary(flag("asOf")),
);
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
console.log(`  tenant ${tenant.slug} (${tenant.name})`);

await pool.end();
