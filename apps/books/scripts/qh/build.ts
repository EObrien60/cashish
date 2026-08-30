#!/usr/bin/env tsx
/**
 * Builds out QuantumHarbour's books from the invoice PDFs plus the bank feed.
 *
 *   DATABASE_URL=… npx tsx scripts/qh/build.ts --tenant quantumharbour [--commit]
 *
 * Without --commit it reports what it WOULD do and writes nothing.
 *
 * Idempotent: an invoice whose number already exists is skipped, a customer is
 * matched by name, and a rule is matched by its match value. Re-running adds
 * only what is missing.
 *
 * Two deliberate positions, because they decide whether the numbers come out
 * right rather than merely look tidy:
 *
 * 1. A payment is recorded ONLY where a real bank line explains it, using that
 *    line's own date and amount. Several invoices are stamped PAID on the PDF
 *    with no matching inflow; those are left open and listed. Inventing a
 *    payment would make the invoice look settled while the money still sits in
 *    the ledger as unexplained — the same figure counted twice — and cash-basis
 *    VAT is driven by payment dates, so a guessed date corrupts the return.
 *
 * 2. Internal pot transfers and own-account currency moves are EXCLUDED, not
 *    categorised. They are not income or expense in either direction.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool, runInTenant, schema, tenantId } from "@cashish/core/db";
import { findTenantBySlug } from "../../src/db/seed";
import { createCustomer, findCustomerByName, updateCustomer } from "../../src/lib/customers";
import { createInvoice, listInvoices, recordPayment } from "../../src/lib/invoices";
import { listRules, saveRule, applyRulesToAll } from "../../src/lib/rules";
import { listTransactions, setExcluded } from "../../src/lib/transactions";
import { listCategories, listVatRates } from "../../src/lib/lookups";
import { round2 } from "../../src/lib/format";

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  if (i !== -1) return args[i + 1];
  return args.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
};
const COMMIT = args.includes("--commit");

type ParsedLine = {
  description: string;
  vat: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};
type ParsedInvoice = {
  number: string;
  customer: string;
  date: string;
  dueDate: string | null;
  subtotal: number;
  tax: number;
  total: number;
  paid: boolean;
  po: string | null;
  lines: ParsedLine[];
};

// --- customers -------------------------------------------------------------
// Addresses come from the invoice documents. Saoithe Teoranta appears only in
// the bank feed (four inflows, €2,638.35) with no invoice in the PDFs, so it is
// created as a customer but nothing is invoiced to it.
const CUSTOMERS: {
  name: string;
  email?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  country?: string;
  notes?: string;
}[] = [
  {
    name: "J Ryan Haulage Limited",
    addressLine1: "Hartwell Upper",
    city: "Kill",
    addressLine2: "W91 PY80",
    country: "Ireland",
  },
  { name: "Barrowview Medical Practice", country: "Ireland" },
  { name: "O'Brien Hughes Software Consulting Limited", country: "Ireland" },
  {
    name: "TripleBolt",
    addressLine1: "15 Custom House Wharf",
    city: "Portland, Maine 04101",
    country: "United States of America",
    notes: "Outside the EU — services zero-rated for VAT (Export). Pays via Gusto, Inc.",
  },
  {
    name: "Saoithe Teoranta",
    country: "Ireland",
    notes: "Seen in the bank feed only; no invoice document supplied.",
  },
];

/** PDF customer label -> the customer record it means. */
const CUSTOMER_ALIASES: Record<string, string> = {
  "J Ryan Haulage Limited": "J Ryan Haulage Limited",
  "Barrowview Medical Practice": "Barrowview Medical Practice",
  "O'Brien Hughes Software Consulting": "O'Brien Hughes Software Consulting Limited",
  TripleBolt: "TripleBolt",
};

// --- categorisation rules --------------------------------------------------
// `confirm: true` marks an inference worth a human glance rather than a fact
// read off a document. They are all one edit away from being changed.
type RuleSpec = {
  name: string;
  match: string;
  category: string;
  direction?: "any" | "in" | "out";
  field?: "description" | "reference" | "payer" | "mcc" | "any";
  vat?: string | null;
  confirm?: boolean;
  why?: string;
};

const RULES: RuleSpec[] = [
  // ---- income ----
  { name: "J Ryan Haulage — sales", match: "J. RYAN HAULAGE", category: "cat-sales", direction: "in", field: "any", vat: "vat-standard" },
  { name: "Barrowview — sales", match: "BARROWVIEW", category: "cat-sales", direction: "in", field: "any", vat: "vat-standard" },
  { name: "O'Brien Hughes — sales", match: "O'BRIEN HUGHES", category: "cat-sales", direction: "in", field: "any", vat: "vat-standard" },
  { name: "Saoithe Teoranta — sales", match: "SAOITHE", category: "cat-sales", direction: "in", field: "any", vat: "vat-standard" },
  // TripleBolt settles through Gusto; the invoices are Export-rated, so 0%.
  { name: "TripleBolt via Gusto — export sales", match: "GUSTO", category: "cat-sales", direction: "in", field: "any", vat: "vat-zero", confirm: true, why: "Gusto inflows total exactly the €27,000 of the three TripleBolt export invoices" },
  { name: "Revenue refunds", match: "REVENUE COMMISSION", category: "cat-other-income", direction: "in", field: "any", vat: "vat-exempt", confirm: true, why: "an inflow from Revenue is a refund; booked as other income rather than negative tax" },
  { name: "Revolut rewards", match: "REWARD", category: "cat-other-income", direction: "in", field: "description", vat: "vat-exempt" },

  // ---- cost of sales: hardware and licences bought to resell ----
  { name: "TD Synnex — stock", match: "TD SYNNEX", category: "cat-cogs", direction: "out", field: "description", vat: "vat-standard" },
  { name: "Kaseya — licences", match: "KASEYA", category: "cat-cogs", direction: "out", field: "description", vat: "vat-standard" },
  { name: "Ubiquiti store — stock", match: "EU.STORE.UI.COM", category: "cat-cogs", direction: "out", field: "description", vat: "vat-standard" },
  { name: "Elara — stock", match: "ELARA.IE", category: "cat-cogs", direction: "out", field: "description", vat: "vat-standard" },
  { name: "Eurieka IT — stock", match: "EURIEKA", category: "cat-cogs", direction: "out", field: "description", vat: "vat-standard" },
  { name: "CJS CD Keys — licences", match: "CJS CD KEYS", category: "cat-cogs", direction: "out", field: "description", vat: "vat-standard" },
  { name: "Alibaba — stock", match: "ALIBABA", category: "cat-cogs", direction: "out", field: "description", vat: "vat-standard", confirm: true, why: "import — check whether VAT was paid at the point of entry rather than on the card" },
  { name: "Select Galway — stock", match: "SELECT GALWAY", category: "cat-cogs", direction: "out", field: "description", vat: "vat-standard", confirm: true, why: "one €1,408 purchase; stock or equipment?" },

  // ---- software and subscriptions ----
  { name: "OpenAI", match: "OPENAI", category: "cat-software", direction: "out", field: "description", vat: "vat-standard" },
  { name: "Claude", match: "CLAUDE.AI", category: "cat-software", direction: "out", field: "description", vat: "vat-standard" },
  { name: "GitHub", match: "GITHUB", category: "cat-software", direction: "out", field: "description", vat: "vat-standard" },
  { name: "Hetzner", match: "HETZNER", category: "cat-software", direction: "out", field: "any", vat: "vat-standard" },
  { name: "Blacknight", match: "BLACKNIGHT", category: "cat-software", direction: "out", field: "description", vat: "vat-standard" },
  { name: "Sage", match: "SAGE IRELAND", category: "cat-software", direction: "out", field: "description", vat: "vat-standard" },
  { name: "QuickBooks", match: "QBOOKS", category: "cat-software", direction: "out", field: "description", vat: "vat-standard" },
  { name: "Level RMM", match: "LEVEL SOFTWARE", category: "cat-software", direction: "out", field: "description", vat: "vat-standard" },
  { name: "Backblaze", match: "BACKBLAZE", category: "cat-software", direction: "out", field: "description", vat: "vat-standard" },
  { name: "Lucid", match: "LUCID SOFTWARE", category: "cat-software", direction: "out", field: "description", vat: "vat-standard" },
  { name: "Twilio", match: "TWILIO", category: "cat-software", direction: "out", field: "description", vat: "vat-standard" },
  { name: "Slack", match: "SLACK", category: "cat-software", direction: "out", field: "description", vat: "vat-standard" },

  // ---- people ----
  { name: "Xinyu Zhang", match: "XINYU ZHANG", category: "cat-wages", direction: "out", field: "any", vat: "vat-exempt", confirm: true, why: "17 regular payments, €20,364 — staff or a contractor? affects payroll reporting" },
  { name: "Kefan Chen", match: "KEFAN CHEN", category: "cat-wages", direction: "out", field: "any", vat: "vat-exempt", confirm: true, why: "single payment; staff or contractor?" },
  { name: "Jiahong Lin", match: "JIAHONG LIN", category: "cat-wages", direction: "out", field: "any", vat: "vat-exempt", confirm: true, why: "single payment; staff or contractor?" },
  { name: "Yu Xia", match: "YU XIA", category: "cat-wages", direction: "out", field: "any", vat: "vat-exempt", confirm: true, why: "single payment; staff or contractor?" },
  { name: "Matthew Ryan", match: "MATTHEW RYAN", category: "cat-wages", direction: "out", field: "any", vat: "vat-exempt", confirm: true, why: "two payments; staff or contractor?" },
  { name: "Katelynn O'Brien", match: "KATELYNN O'BRIEN", category: "cat-wages", direction: "out", field: "any", vat: "vat-exempt", confirm: true, why: "two payments; staff or contractor?" },

  // ---- owner ----
  { name: "Owner — money out", match: "TO ETHAN PAUL OBRIEN", category: "cat-drawings", direction: "out", field: "description", vat: "vat-exempt", confirm: true, why: "drawings, salary or a director's loan repayment? they are taxed differently" },
  { name: "Owner — money in", match: "ETHAN PAUL OBRIEN", category: "cat-drawings", direction: "in", field: "any", vat: "vat-exempt", confirm: true, why: "director funding the company; booked against the same account as drawings" },

  // ---- other overheads ----
  { name: "Revenue payments", match: "REVENUE COMMISSIONERS", category: "cat-tax", direction: "out", field: "description", vat: "vat-exempt" },
  { name: "Revolut fees", match: "REVOLUT BUSINESS FEE", category: "cat-bank", direction: "out", field: "description", vat: "vat-exempt" },
  { name: "Buzzworks Design", match: "BUZZWORKS", category: "cat-marketing", direction: "out", field: "description", vat: "vat-standard", confirm: true, why: "€7,661 to a design studio — marketing, or work resold to a client?" },
  { name: "Trip.com", match: "TRIP.COM", category: "cat-travel", direction: "out", field: "description", vat: "vat-standard" },
  { name: "Premier Inn", match: "PREMIER INN", category: "cat-travel", direction: "out", field: "description", vat: "vat-standard" },
  { name: "Apple", match: "APPLE.COM", category: "cat-office", direction: "out", field: "description", vat: "vat-standard", confirm: true, why: "€1,249 — own equipment or stock for a client?" },
  { name: "Currys", match: "CURRYS", category: "cat-office", direction: "out", field: "description", vat: "vat-standard", confirm: true },
  { name: "Amazon", match: "AMAZON", category: "cat-office", direction: "out", field: "description", vat: "vat-standard", confirm: true },
  { name: "UPS", match: "UPS IE", category: "cat-office", direction: "out", field: "description", vat: "vat-standard" },
];

/**
 * Internal movements: Revolut pots and own-account FX. Excluded rather than
 * categorised, so they are counted nowhere while the statement still reconciles
 * line for line.
 */
const EXCLUDE_MATCHES = [
  { match: "TO TAX", reason: "transfer to own tax pot" },
  { match: "FROM TAX", reason: "transfer back from own tax pot" },
  { match: "TO PAYROLLTAX", reason: "transfer to own payroll-tax pot" },
  { match: "FROM PAYROLLTAX", reason: "transfer back from own payroll-tax pot" },
  { match: "FROM EURO", reason: "transfer between own accounts" },
  { match: "TO EURO", reason: "transfer between own accounts" },
  { match: "MAIN · EUR → MAIN · GBP", reason: "own-account currency exchange" },
  { match: "MAIN · GBP → MAIN · EUR", reason: "own-account currency exchange" },
];

const VAT_FOR_CLASS: Record<string, string> = {
  Standard: "vat-standard",
  Export: "vat-zero",
  Zero: "vat-zero",
  Exempt: "vat-exempt",
  Reduced: "vat-reduced",
};

async function main() {
  const slug = flag("tenant") ?? "quantumharbour";
  const tenant = await findTenantBySlug(slug);
  if (!tenant) {
    console.error(`no tenant "${slug}"`);
    process.exit(1);
  }
  const parsed: ParsedInvoice[] = JSON.parse(
    readFileSync(join(__dirname, "invoices.json"), "utf8"),
  );

  console.log(`${COMMIT ? "COMMITTING to" : "DRY RUN against"} tenant ${slug}\n`);

  await runInTenant({ tenantId: tenant.id, role: "owner", actor: "qh-build" }, async () => {
    const tid = tenantId();
    const scoped = (base: string) => `${tid}:${base}`;
    const cats = new Map((await listCategories()).map((c) => [c.id, c]));
    const rates = new Map((await listVatRates()).map((r) => [r.id, r]));

    // ---- 1. customers ----
    console.log("── customers");
    for (const c of CUSTOMERS) {
      const existing = await findCustomerByName(c.name);
      if (existing) {
        console.log(`   exists  ${c.name}`);
        continue;
      }
      if (COMMIT) await createCustomer(c);
      console.log(`   ${COMMIT ? "created" : "would create"}  ${c.name}`);
    }

    // ---- 2. invoices ----
    console.log("\n── invoices");
    const already = new Set((await listInvoices()).map((i) => i.number));
    let created = 0;
    let invoicedNet = 0;
    let invoicedVat = 0;
    for (const inv of parsed) {
      if (already.has(inv.number)) {
        console.log(`   exists  ${inv.number}`);
        continue;
      }
      const custName = CUSTOMER_ALIASES[inv.customer] ?? inv.customer;
      const customer = await findCustomerByName(custName);
      if (!customer && COMMIT) {
        console.log(`   SKIP    ${inv.number} — no customer "${custName}"`);
        continue;
      }
      const lines = inv.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        vatRateId: scoped(VAT_FOR_CLASS[l.vat] ?? "vat-standard"),
        productId: null,
      }));
      invoicedNet = round2(invoicedNet + inv.subtotal);
      invoicedVat = round2(invoicedVat + inv.tax);

      if (COMMIT) {
        const result = await createInvoice({
          customerId: customer!.id,
          // Verbatim: the number on the document the customer already holds.
          number: inv.number,
          // Everything lands as "sent". Payments are recorded separately, from
          // real bank lines, and the status is derived from them.
          status: "sent",
          issueDate: inv.date,
          dueDate: inv.dueDate,
          notes: inv.po ? `PO: ${inv.po}` : "",
          lines,
        });
        // A mismatch here means the line maths and the document disagree.
        if (result && Math.abs(result.total - inv.total) > 0.02) {
          console.log(
            `   WARN    ${inv.number} computed ${result.total} but document says ${inv.total}`,
          );
        }
      }
      created++;
      console.log(
        `   ${COMMIT ? "created" : "would create"} ${inv.number}  ${inv.date}  ` +
          `${custName.slice(0, 30).padEnd(30)} ${String(inv.total).padStart(10)}  ${inv.lines.length} lines`,
      );
    }
    console.log(`   ${created} invoice(s); net ${invoicedNet} + VAT ${invoicedVat}`);

    // ---- 3. rules ----
    console.log("\n── rules");
    const existingRules = new Set((await listRules()).map((r) => r.matchValue.toUpperCase()));
    let ruleCount = 0;
    for (const r of RULES) {
      if (existingRules.has(r.match.toUpperCase())) {
        console.log(`   exists  ${r.name}`);
        continue;
      }
      const catId = scoped(r.category);
      if (!cats.has(catId)) {
        console.log(`   SKIP    ${r.name} — unknown category ${r.category}`);
        continue;
      }
      const vatId = r.vat ? scoped(r.vat) : null;
      if (vatId && !rates.has(vatId)) {
        console.log(`   SKIP    ${r.name} — unknown VAT rate ${r.vat}`);
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
          vatRateId: vatId,
          enabled: true,
        });
      }
      ruleCount++;
      console.log(
        `   ${COMMIT ? "created" : "would create"} ${r.name.padEnd(32)} -> ` +
          `${cats.get(catId)!.name}${r.confirm ? "   [confirm]" : ""}`,
      );
    }
    console.log(`   ${ruleCount} rule(s)`);

    // ---- 4. exclusions ----
    console.log("\n── exclusions (internal transfers)");
    const all = await listTransactions({ excluded: "all" });
    for (const spec of EXCLUDE_MATCHES) {
      const hits = all.filter(
        (t) =>
          !t.excluded &&
          `${t.description ?? ""} ${t.reference ?? ""} ${t.payer ?? ""}`
            .toUpperCase()
            .includes(spec.match.toUpperCase()),
      );
      if (hits.length === 0) continue;
      const total = round2(hits.reduce((s, t) => s + Math.abs(t.amount), 0));
      if (COMMIT) await setExcluded(hits.map((t) => t.id), true, spec.reason);
      console.log(
        `   ${COMMIT ? "excluded" : "would exclude"} ${String(hits.length).padStart(3)} x  ` +
          `${total.toFixed(2).padStart(10)}  ${spec.match}`,
      );
    }

    // ---- 5. apply the rules ----
    if (COMMIT) {
      const applied = await applyRulesToAll();
      console.log(
        `\n── applied rules: matched ${applied.matched}, updated ${applied.updated}, ` +
          `recategorised ${applied.recategorised}`,
      );
    } else {
      console.log("\n── rules would then be applied across the whole ledger");
    }
  });

  await pool.end();
}

main().catch(async (e) => {
  console.error("build failed:", e);
  await pool.end().catch(() => {});
  process.exit(1);
});
