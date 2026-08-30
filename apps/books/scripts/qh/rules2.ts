#!/usr/bin/env tsx
/**
 * A second pass of rules, for the tail left uncategorised after the first.
 *
 *   npx tsx scripts/qh/rules2.ts --tenant quantumharbour [--commit]
 */
import { pool, runInTenant, tenantId } from "@cashish/core/db";
import { findTenantBySlug } from "../../src/db/seed";
import { listRules, saveRule, applyRulesToAll } from "../../src/lib/rules";
import { listCategories, listVatRates } from "../../src/lib/lookups";

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 ? args[i + 1] : undefined;
};
const COMMIT = args.includes("--commit");

type R = {
  name: string;
  match: string;
  category: string;
  vat: string;
  direction?: "any" | "in" | "out";
  field?: "description" | "any";
  confirm?: boolean;
  why?: string;
};

const RULES: R[] = [
  // Suppliers. BLS is the card descriptor Kaseya bills through; the two bare
  // "BLS" lines sit alongside 17 "BLS*KASEYA.COM" ones.
  { name: "BLS (Kaseya processor)", match: "BLS", category: "cat-cogs", vat: "vat-standard", direction: "out", confirm: true, why: "two lines, €1,922.40 — same processor as the Kaseya charges, but confirm it is not something else" },
  { name: "Taobao", match: "TAOBAO", category: "cat-cogs", vat: "vat-standard", direction: "out" },
  { name: "Gouwu (Alipay)", match: "GOUWUXIAOFEI", category: "cat-cogs", vat: "vat-standard", direction: "out" },
  { name: "CeX Galway", match: "CEX GALWAY", category: "cat-cogs", vat: "vat-standard", direction: "out", confirm: true },
  { name: "G2A", match: "G2A", category: "cat-cogs", vat: "vat-standard", direction: "out", confirm: true },
  { name: "K4G", match: "K4GCOM", category: "cat-cogs", vat: "vat-standard", direction: "out", confirm: true },

  // Software and hosting.
  { name: "AWS", match: "AWS EMEA", category: "cat-software", vat: "vat-standard", direction: "out" },
  { name: "Microsoft", match: "MICROSOFT", category: "cat-software", vat: "vat-standard", direction: "out" },
  { name: "DocuSign", match: "DOCUSIGN", category: "cat-software", vat: "vat-standard", direction: "out" },
  { name: "Tailscale", match: "TAILSCALE", category: "cat-software", vat: "vat-standard", direction: "out" },
  { name: "Anthropic", match: "ANTHROPIC", category: "cat-software", vat: "vat-standard", direction: "out" },
  { name: "Namecheap", match: "NAMECHEAP", category: "cat-software", vat: "vat-standard", direction: "out" },
  { name: "Namecheap (alt)", match: "NAME-CHEAP", category: "cat-software", vat: "vat-standard", direction: "out" },

  // Overheads.
  { name: "Clear Mobile", match: "CLEAR MOBILE", category: "cat-rent", vat: "vat-standard", direction: "out", confirm: true, why: "phone line — booked under utilities" },
  { name: "IKEA", match: "IKEA", category: "cat-office", vat: "vat-standard", direction: "out" },
  { name: "Companies Registration Office", match: "COMPANIES REGISTRATION", category: "cat-professional", vat: "vat-exempt", direction: "out" },
  { name: "Upwork", match: "UPWRKESCROW", category: "cat-professional", vat: "vat-standard", direction: "out", confirm: true, why: "contractor work through Upwork" },
  // A Revenue Sheriff collects unpaid tax under a court certificate. Booked to
  // tax, and worth knowing about in its own right.
  { name: "Revenue Sheriff", match: "REVENUE SHERIFF", category: "cat-tax", vat: "vat-exempt", direction: "out", confirm: true, why: "a sheriff payment means Revenue enforcement — worth checking the underlying liability is now clear" },
  { name: "O'Brien Hughes — paid out", match: "TO O'BRIEN HUGHES", category: "cat-professional", vat: "vat-standard", direction: "out", confirm: true, why: "money out to your other company; intercompany, or a purchase?" },
];

async function main() {
  const slug = flag("tenant") ?? "quantumharbour";
  const tenant = await findTenantBySlug(slug);
  if (!tenant) {
    console.error(`no tenant "${slug}"`);
    process.exit(1);
  }
  await runInTenant({ tenantId: tenant.id, role: "owner", actor: "qh-rules2" }, async () => {
    const tid = tenantId();
    const scoped = (b: string) => `${tid}:${b}`;
    const cats = new Map((await listCategories()).map((c) => [c.id, c]));
    const rates = new Map((await listVatRates()).map((r) => [r.id, r]));
    const seen = new Set((await listRules()).map((r) => r.matchValue.toUpperCase()));

    let n = 0;
    for (const r of RULES) {
      if (seen.has(r.match.toUpperCase())) {
        console.log(`   exists  ${r.name}`);
        continue;
      }
      const catId = scoped(r.category);
      if (!cats.has(catId)) {
        console.log(`   SKIP    ${r.name} — unknown category "${r.category}"`);
        continue;
      }
      if (!rates.has(scoped(r.vat))) {
        console.log(`   SKIP    ${r.name} — unknown VAT rate "${r.vat}"`);
        continue;
      }
      if (COMMIT) {
        await saveRule({
          name: r.name,
          matchField: r.field ?? "description",
          matchType: "contains",
          matchValue: r.match,
          direction: r.direction ?? "any",
          categoryId: catId,
          vatRateId: scoped(r.vat),
          enabled: true,
        });
      }
      n++;
      console.log(
        `   ${COMMIT ? "created" : "would create"} ${r.name.padEnd(30)} -> ${cats.get(catId)!.name}` +
          `${r.confirm ? "   [confirm]" : ""}`,
      );
    }
    console.log(`   ${n} rule(s)`);
    if (COMMIT) {
      const a = await applyRulesToAll();
      console.log(`\napplied: matched ${a.matched}, updated ${a.updated}, recategorised ${a.recategorised}`);
    }
  });
  await pool.end();
}

main().catch(async (e) => {
  console.error("failed:", e);
  await pool.end().catch(() => {});
  process.exit(1);
});
