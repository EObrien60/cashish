#!/usr/bin/env tsx
/**
 * Gives existing rules a posting kind.
 *
 *   npx tsx scripts/rules/classify.ts --tenant obh [--commit]
 *
 * Infers the kind from what a rule already carries, and ONLY where the kind's
 * requirement is already satisfiable — a rule assigned "sales_receipt" with no
 * customer would fail its own validation the next time anyone edited it, which
 * is worse than leaving it as "other".
 *
 * A customer or vendor is matched by name where the rule's match text is clearly
 * a shortening of it ("BARROWVIEW" for "Barrowview Medical Practice"). Anything
 * unclear is left alone and printed rather than guessed.
 */
import { and, eq } from "drizzle-orm";
import { db, pool, runInTenant, schema, tenantId } from "@cashish/core/db";
import { findTenantBySlug } from "../../src/db/seed";
import { listRules } from "../../src/lib/rules";
import { listCategories } from "../../src/lib/lookups";
import { listCustomers } from "../../src/lib/customers";
import { listVendors } from "../../src/lib/vendors";
import { POSTING_SPECS, validatePosting, type Posting } from "../../src/lib/posting";

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 ? args[i + 1] : undefined;
};
const COMMIT = args.includes("--commit");

/** Loose comparison: letters and digits only, upper case. */
const key = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** True when `needle` looks like a shortening of `name`. */
function looksLike(needle: string, name: string) {
  const a = key(needle);
  const b = key(name);
  if (a.length < 4) return false;
  return b.startsWith(a) || b.includes(a);
}

/**
 * Payer aliases: the bank counterparty is not the customer.
 *
 * Established earlier from the invoice totals, not guessed — Gusto's inflows sum
 * to exactly the €27,000 of TripleBolt's three export invoices. A name-similarity
 * check can never find this, so it is stated.
 */
const CUSTOMER_ALIASES: [RegExp, string][] = [[/GUSTO/i, "TripleBolt"]];

const TAX_HINTS: [RegExp, string][] = [
  [/\bVAT\b/i, "vat"],
  [/PAYROLL ?TAX|\bPAYE\b|PRSI|USC/i, "paye"],
  [/CORPORATION|\bCT\b/i, "ct"],
];

async function main() {
  const slug = flag("tenant");
  if (!slug) {
    console.error("--tenant <slug> is required");
    process.exit(1);
  }
  const tenant = await findTenantBySlug(slug);
  if (!tenant) {
    console.error(`no tenant "${slug}"`);
    process.exit(1);
  }

  console.log(`${COMMIT ? "COMMITTING to" : "DRY RUN against"} ${slug}\n`);

  await runInTenant({ tenantId: tenant.id, role: "owner", actor: "classify" }, async () => {
    const tid = tenantId();
    const rules = await listRules();
    const cats = new Map((await listCategories()).map((c) => [c.id, c]));
    const customers = await listCustomers({ includeArchived: true });
    const vendors = await listVendors({ includeArchived: true });

    const counts = new Map<string, number>();
    const unresolved: string[] = [];

    for (const r of rules) {
      const cat = r.categoryId ? cats.get(r.categoryId) : null;
      const catName = cat?.name ?? "";
      let posting: Posting = "other";
      let customerId: string | null = r.customerId ?? null;
      let vendorId: string | null = r.vendorId ?? null;
      let taxKind: string | null = r.taxKind ?? null;
      let reason = "";

      if (r.employeeId) {
        posting = "payroll";
        reason = "names a person";
      } else if (r.vendorId) {
        posting = "vendor_payment";
        reason = "names a vendor";
      } else if (/REVENUE/i.test(r.matchValue)) {
        // Revenue in EITHER direction is tax. A refund from Revenue was landing
        // in the income branch and failing to find a customer, because the test
        // was on the category name and a refund books to Other income.
        posting = "tax";
        taxKind = TAX_HINTS.find(([re]) => re.test(r.matchValue))?.[1] ?? "other";
        reason = r.direction === "in" ? "a refund from Revenue is still tax" : "paid to Revenue";
      } else if (/Taxes|Revenue/i.test(catName)) {
        posting = "tax";
        taxKind = TAX_HINTS.find(([re]) => re.test(r.matchValue))?.[1] ?? "other";
        reason = `books to ${catName}`;
      } else if (cat?.kind === "income" && r.direction !== "out") {
        const aliasName = CUSTOMER_ALIASES.find(([re]) => re.test(r.matchValue))?.[1];
        // Loose comparison, not equality: OBH's customer is "TripleBolt
        // Technology LLC", so an exact match on "TripleBolt" found nothing and
        // €35,000 of Gusto receipts stayed unattributed.
        const hit =
          (aliasName ? customers.find((c) => looksLike(aliasName, c.name)) : undefined) ??
          customers.find((c) => looksLike(r.matchValue, c.name));
        if (hit) {
          posting = "sales_receipt";
          customerId = hit.id;
          reason = aliasName
            ? `pays for ${hit.name}`
            : `matched customer ${hit.name}`;
        } else {
          unresolved.push(`    "${r.matchValue}" -> income, but no customer matches its name`);
        }
      } else if (cat?.kind === "expense") {
        const hit = vendors.find((v) => looksLike(r.matchValue, v.name));
        if (hit) {
          posting = "vendor_payment";
          vendorId = hit.id;
          reason = `matched vendor ${hit.name}`;
        }
      }

      // Never write something that would fail its own validation.
      const problem = validatePosting({
        posting,
        customerId,
        vendorId,
        employeeId: r.employeeId,
        taxKind,
        direction: r.direction,
      });
      if (problem) {
        unresolved.push(`    "${r.matchValue}" -> would be ${posting}, but: ${problem}`);
        posting = "other";
        customerId = null;
        vendorId = r.vendorId ?? null;
        taxKind = null;
        reason = "left as other";
      }

      counts.set(posting, (counts.get(posting) ?? 0) + 1);
      const changed =
        posting !== r.posting ||
        customerId !== (r.customerId ?? null) ||
        taxKind !== (r.taxKind ?? null);
      if (changed) {
        if (COMMIT) {
          await db
            .update(schema.categoryRules)
            .set({
              posting,
              customerId,
              vendorId,
              direction: POSTING_SPECS[posting].direction ?? r.direction,
              taxKind,
            })
            .where(and(eq(schema.categoryRules.tenantId, tid), eq(schema.categoryRules.id, r.id)));
        }
        console.log(
          `  ${COMMIT ? "set" : "would set"} ${posting.padEnd(15)} "${r.matchValue}"` +
            (reason ? `   (${reason})` : ""),
        );
      }
    }

    console.log("\n  by kind:");
    for (const [k, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(3)}  ${k}`);
    }
    if (unresolved.length) {
      console.log(`\n  left as "other" and worth a look (${unresolved.length}):`);
      for (const u of unresolved) console.log(u);
    }
  });

  await pool.end();
}

main().catch(async (e) => {
  console.error("failed:", e);
  await pool.end().catch(() => {});
  process.exit(1);
});
