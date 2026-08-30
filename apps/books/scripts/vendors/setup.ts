#!/usr/bin/env tsx
/**
 * Creates vendors and attributes their payments, for QuantumHarbour and OBH.
 *
 *   npx tsx scripts/vendors/setup.ts --tenant quantumharbour [--commit]
 *
 * Same mechanism as scripts/people/setup.ts: attach the vendor to the
 * categorisation rule that already recognises the name, then re-apply the rules
 * so the whole history is attributed in one pass.
 *
 * The list is explicit. Deriving suppliers from bank descriptions would sweep in
 * staff payments, pot transfers and Revenue, and a wrong vendor is more annoying
 * to unpick than a missing one. Whatever is left unattributed gets printed.
 */
import { and, eq } from "drizzle-orm";
import { db, pool, schema } from "../../src/db/client";
import { runInTenant, tenantId } from "../../src/db/context";
import { findTenantBySlug } from "../../src/db/seed";
import {
  createVendor,
  listVendors,
  vendorTotals,
  setTransactionVendor,
} from "../../src/lib/vendors";
import { listRules, applyRulesToAll } from "../../src/lib/rules";
import { listTransactions } from "../../src/lib/transactions";
import { listCategories } from "../../src/lib/lookups";
import { round2 } from "../../src/lib/format";

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 ? args[i + 1] : undefined;
};
const COMMIT = args.includes("--commit");
const AUDIT = args.includes("--audit");

type V = { name: string; matches: string[]; category?: string; note?: string };

const VENDORS: Record<string, V[]> = {
  quantumharbour: [
    { name: "Kaseya", matches: ["KASEYA", "BLS"], category: "cat-cogs", note: "Bills through the BLS card descriptor." },
    { name: "TD Synnex Ireland Limited", matches: ["TD SYNNEX"], category: "cat-cogs" },
    { name: "Ubiquiti", matches: ["EU.STORE.UI.COM"], category: "cat-cogs" },
    { name: "Elara", matches: ["ELARA.IE"], category: "cat-cogs" },
    { name: "Eurieka IT Services", matches: ["EURIEKA"], category: "cat-cogs" },
    { name: "CJS CD Keys", matches: ["CJS CD KEYS"], category: "cat-cogs" },
    { name: "Alibaba", matches: ["ALIBABA"], category: "cat-cogs" },
    { name: "Taobao", matches: ["TAOBAO", "GOUWUXIAOFEI"], category: "cat-cogs" },
    { name: "Buzzworks Design Studio", matches: ["BUZZWORKS"], category: "cat-marketing" },
    { name: "Hetzner Online", matches: ["HETZNER"], category: "cat-software" },
    { name: "Blacknight", matches: ["BLACKNIGHT"], category: "cat-software" },
    { name: "OpenAI", matches: ["OPENAI"], category: "cat-software" },
    { name: "Anthropic", matches: ["CLAUDE.AI", "ANTHROPIC"], category: "cat-software" },
    { name: "GitHub", matches: ["GITHUB"], category: "cat-software" },
    { name: "Microsoft", matches: ["MICROSOFT"], category: "cat-software" },
    { name: "Amazon Web Services", matches: ["AWS EMEA"], category: "cat-software" },
    { name: "Sage Ireland", matches: ["SAGE IRELAND"], category: "cat-software" },
    { name: "Intuit QuickBooks", matches: ["QBOOKS"], category: "cat-software" },
    { name: "Level Software", matches: ["LEVEL SOFTWARE"], category: "cat-software" },
    { name: "Backblaze", matches: ["BACKBLAZE"], category: "cat-software" },
    { name: "Lucid Software", matches: ["LUCID SOFTWARE"], category: "cat-software" },
    { name: "Twilio", matches: ["TWILIO"], category: "cat-software" },
    { name: "Slack", matches: ["SLACK"], category: "cat-software" },
    { name: "DocuSign", matches: ["DOCUSIGN"], category: "cat-software" },
    { name: "Tailscale", matches: ["TAILSCALE"], category: "cat-software" },
    { name: "Namecheap", matches: ["NAMECHEAP", "NAME-CHEAP"], category: "cat-software" },
    { name: "Clear Mobile", matches: ["CLEAR MOBILE"], category: "cat-rent" },
    { name: "Companies Registration Office", matches: ["COMPANIES REGISTRATION"], category: "cat-professional" },
    { name: "Upwork", matches: ["UPWRKESCROW"], category: "cat-professional" },
    { name: "Revolut", matches: ["REVOLUT BUSINESS FEE"], category: "cat-bank" },
    { name: "Select Galway", matches: ["SELECT GALWAY"], category: "cat-cogs" },
    { name: "CeX Galway", matches: ["CEX GALWAY"], category: "cat-cogs" },
    { name: "G2A", matches: ["G2A"], category: "cat-cogs" },
    { name: "K4G", matches: ["K4GCOM"], category: "cat-cogs" },
    { name: "Apple", matches: ["APPLE.COM"], category: "cat-office" },
    { name: "Currys", matches: ["CURRYS"], category: "cat-office" },
    { name: "Amazon", matches: ["AMAZON"], category: "cat-office" },
    { name: "IKEA", matches: ["IKEA"], category: "cat-office" },
    { name: "UPS", matches: ["UPS IE"], category: "cat-office" },
    { name: "Trip.com", matches: ["TRIP.COM"], category: "cat-travel" },
    { name: "Premier Inn", matches: ["PREMIER INN"], category: "cat-travel" },
    {
      name: "Revenue Commissioners",
      matches: ["REVENUE COMMISSIONERS"],
      category: "cat-tax",
      note: "Not a supplier, but the largest single outflow — worth attributing so /vendors accounts for it.",
    },
    {
      name: "Revenue Sheriff (Padraic Brennan)",
      matches: ["REVENUE SHERIFF"],
      category: "cat-tax",
      note: "A separate payee from Revenue itself; a sheriff payment means enforcement.",
    },
    {
      name: "O'Brien Hughes Software Consulting",
      matches: ["TO O'BRIEN HUGHES"],
      category: "cat-professional",
      note: "Your other company.",
    },
  ],
  obh: [
    { name: "Buzzworks Design Studio", matches: ["Buzzworks"], category: "cat-marketing" },
    {
      name: "Quantum Harbour IT Systems",
      matches: ["Quantum Harbour"],
      category: "cat-cogs",
      note: "Your other company. It invoices OBH the matching amount.",
    },
    { name: "Hetzner Online", matches: ["Hetzner"], category: "cat-software" },
    {
      name: "Galway City Innovation District",
      // The bank shortens it to "Gcid" on most lines. The third entry is the
      // exact matchValue of the existing regex rule, so the RULE gets linked
      // too and future imports attribute themselves.
      matches: ["gcid|galway city innovation", "GALWAY CITY INNOVATION", "Gcid"],
      category: "cat-rent",
    },
    { name: "Anthropic", matches: ["Claude.ai", "Anthropic"], category: "cat-software" },
    { name: "Apple", matches: ["Apple.com"], category: "cat-office" },
    { name: "Select Galway", matches: ["Select Galway"], category: "cat-cogs" },
    {
      name: "Cuffe & Company (Insurance)",
      matches: ["CUFFE & COMPANY"],
      category: "cat-professional",
    },
    { name: "Intuit QuickBooks", matches: ["Intuit"], category: "cat-software" },
    { name: "Replit", matches: ["Replit"], category: "cat-software" },
    { name: "Sage Ireland", matches: ["Sage Ireland"], category: "cat-software" },
    { name: "Microsoft", matches: ["Microsoft"], category: "cat-software" },
    { name: "Vercel", matches: ["Vercel"], category: "cat-software" },
    { name: "n8n", matches: ["N8n"], category: "cat-software" },
    { name: "Google Workspace", matches: ["Google Workspace"], category: "cat-software" },
    { name: "Namecheap", matches: ["Name-cheap"], category: "cat-software" },
    { name: "Blacknight", matches: ["Blacknight"], category: "cat-software" },
    { name: "Currys", matches: ["Currys"], category: "cat-office" },
    { name: "Ryanair", matches: ["Ryanair"], category: "cat-travel" },
    { name: "Three Ireland", matches: ["Three Ireland"], category: "cat-rent" },
    { name: "Revolut", matches: ["Revolut Business Fee"], category: "cat-bank" },
    {
      name: "Revenue Commissioners",
      matches: ["Revenue Commissioners"],
      category: "cat-tax",
      note: "Not a supplier, but the largest single outflow — worth attributing so /vendors accounts for it.",
    },
  ],
};

/**
 * Lists expense rules that attribute money to neither a vendor nor a person.
 *
 * Exists because the gap is invisible otherwise: a rule can categorise spend
 * perfectly and still leave /vendors unable to say who was paid, and nobody
 * notices until they look at the vendor list and find it short.
 */
async function audit(slug: string) {
  const { ruleMatches } = await import("../../src/lib/rules");
  const rules = await listRules();
  const txs = await listTransactions({ excluded: "all" });
  const cats = new Map((await listCategories()).map((c) => [c.id, c]));
  const vendors = await listVendors({ includeArchived: true });

  const gap = rules.filter(
    (r) =>
      !r.vendorId &&
      !r.employeeId &&
      cats.get(r.categoryId ?? "")?.kind === "expense" &&
      txs.some((x) => ruleMatches(r as never, x as never)),
  );
  const dead = rules.filter((r) => !txs.some((x) => ruleMatches(r as never, x as never)));

  console.log(`${slug}: ${rules.length} rules, ${vendors.length} vendors`);
  console.log(`  expense rules attributing to nobody: ${gap.length}`);
  for (const r of gap) {
    const hits = txs.filter((x) => !x.excluded && x.amount < 0 && ruleMatches(r as never, x as never));
    const total = round2(hits.reduce((s2, x) => s2 + Math.abs(x.amount), 0));
    console.log(
      `    ${String(total).padStart(11)} x${String(hits.length).padStart(3)}  ` +
        `${(cats.get(r.categoryId ?? "")?.name ?? "—").padEnd(26)} "${r.matchValue}"`,
    );
  }
  if (dead.length) {
    console.log(`  rules matching nothing (check the match type): ${dead.length}`);
    for (const r of dead) console.log(`    "${r.matchValue}" (${r.matchType})`);
  }
}

async function main() {
  const slug = flag("tenant");
  if (!slug || !VENDORS[slug]) {
    console.error(`--tenant must be one of: ${Object.keys(VENDORS).join(", ")}`);
    process.exit(1);
  }
  const tenant = await findTenantBySlug(slug);
  if (!tenant) {
    console.error(`no tenant "${slug}"`);
    process.exit(1);
  }

  if (AUDIT) {
    await runInTenant({ tenantId: tenant.id, role: "owner", actor: "vendor-audit" }, () =>
      audit(slug),
    );
    await pool.end();
    return;
  }

  console.log(`${COMMIT ? "COMMITTING to" : "DRY RUN against"} ${slug}\n`);

  await runInTenant({ tenantId: tenant.id, role: "owner", actor: "vendor-setup" }, async () => {
    const tid = tenantId();
    const scoped = (b: string) => `${tid}:${b}`;
    const cats = new Map((await listCategories()).map((c) => [c.id, c]));
    const rules = await listRules();
    const byMatch = new Map(rules.map((r) => [r.matchValue.toUpperCase(), r]));

    for (const v of VENDORS[slug]) {
      const existing = (await listVendors({ includeArchived: true })).find(
        (x) => x.name.toLowerCase() === v.name.toLowerCase(),
      );
      let vendorId = existing?.id;
      if (!vendorId) {
        const defaultCategoryId =
          v.category && cats.has(scoped(v.category)) ? scoped(v.category) : null;
        if (COMMIT) {
          vendorId = (await createVendor({ name: v.name, defaultCategoryId })).vendor.id;
        }
        console.log(`   ${COMMIT ? "created" : "would create"}  ${v.name}`);
      } else {
        console.log(`   exists           ${v.name}`);
      }

      for (const m of v.matches) {
        const rule = byMatch.get(m.toUpperCase());
        if (!rule) {
          // No rule carries this name, so attribute the payments directly.
          // Outgoing only, and only ones not already claimed by another vendor.
          const hits = (await listTransactions({ direction: "out", excluded: "all" })).filter(
            (t) =>
              !t.vendorId &&
              !t.excluded &&
              `${t.description ?? ""} ${t.reference ?? ""} ${t.payer ?? ""}`
                .toUpperCase()
                .includes(m.toUpperCase()),
          );
          if (hits.length === 0) {
            console.log(`     ! no rule and no payments matching "${m}"`);
            continue;
          }
          const total = round2(hits.reduce((s2, t) => s2 + Math.abs(t.amount), 0));
          if (COMMIT && vendorId) {
            await setTransactionVendor(
              hits.map((t) => t.id),
              vendorId,
            );
          }
          console.log(
            `     ${COMMIT ? "attributed" : "would attribute"} ${hits.length} payment(s), ` +
              `${total} directly (no rule for "${m}")`,
          );
          continue;
        }
        if (rule.vendorId && rule.vendorId === vendorId) {
          console.log(`     rule "${m}" already linked`);
          continue;
        }
        if (COMMIT && vendorId) {
          await db
            .update(schema.categoryRules)
            .set({ vendorId })
            .where(and(eq(schema.categoryRules.tenantId, tid), eq(schema.categoryRules.id, rule.id)));
        }
        console.log(`     ${COMMIT ? "linked" : "would link"} rule "${m}"`);
      }
      if (v.note) console.log(`     note: ${v.note}`);
    }

    if (COMMIT) {
      const applied = await applyRulesToAll();
      console.log(
        `\n   re-applied rules: matched ${applied.matched}, updated ${applied.updated}`,
      );

      const totals = await vendorTotals();
      const list = await listVendors({ includeArchived: true });
      console.log("\n   lifetime spend by vendor:");
      let sum = 0;
      for (const v of list.sort(
        (x, y) => (totals.get(y.id)?.spend ?? 0) - (totals.get(x.id)?.spend ?? 0),
      )) {
        const t = totals.get(v.id);
        if (!t?.spend) continue;
        sum = round2(sum + t.spend);
        console.log(
          `     ${String(t.spend).padStart(11)}  x${String(t.txCount).padStart(3)}  ${v.name}`,
        );
      }
      console.log(`     ${String(sum).padStart(11)}  attributed to a vendor`);

      const out = (await listTransactions({ direction: "out" })).filter((t) => !t.vendorId);
      const unattributed = round2(out.reduce((s, t) => s + Math.abs(t.amount), 0));
      console.log(`\n   ${out.length} outgoing payment(s) still without a vendor, ${unattributed} total`);
      const byName = new Map<string, { n: number; t: number }>();
      for (const t of out) {
        const k = (t.description ?? "?").slice(0, 42);
        const c = byName.get(k) ?? { n: 0, t: 0 };
        c.n++;
        c.t = round2(c.t + Math.abs(t.amount));
        byName.set(k, c);
      }
      for (const [k, v] of [...byName.entries()].sort((x, y) => y[1].t - x[1].t).slice(0, 10)) {
        console.log(`     ${String(v.t).padStart(11)}  x${String(v.n).padStart(3)}  ${k}`);
      }
    }
  });

  await pool.end();
}

main().catch(async (e) => {
  console.error("failed:", e);
  await pool.end().catch(() => {});
  process.exit(1);
});
