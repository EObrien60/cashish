#!/usr/bin/env tsx
/**
 * Builds the product library from the invoice line items.
 *
 *   npx tsx scripts/qh/products.ts --tenant quantumharbour [--commit]
 *   npx tsx scripts/qh/products.ts --tenant quantumharbour --commit --with-licences
 *   npx tsx scripts/qh/products.ts --tenant quantumharbour --commit --with-services
 *
 * Hardware only by default. Software licences and services are each one flag
 * away, because whether a Microsoft licence belongs in a product library
 * alongside monitors is a bookkeeping preference, not a fact.
 *
 * Every product is created as a `good`, standard-rated, with Sales as its income
 * category. The unit price is the MOST RECENT price charged; where it changed
 * over time the history is recorded in the description, because a product
 * library that silently averages prices is worse than none.
 *
 * Existing invoice lines are then linked to the product they matched, so the
 * library is connected to the history rather than being a fresh empty list.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool, runInTenant, schema, tenantId } from "@cashish/core/db";
import { findTenantBySlug } from "../../src/db/seed";
import { listProducts } from "../../src/lib/lookups";
import { uid } from "../../src/lib/id";

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 ? args[i + 1] : undefined;
};
const COMMIT = args.includes("--commit");
const WITH_LICENCES = args.includes("--with-licences");
const WITH_SERVICES = args.includes("--with-services");

/**
 * Corrections read off the invoice PDFs by eye, where `pdftotext -layout` could
 * not be trusted. Kept explicit so each one is auditable rather than buried in
 * the parser.
 *
 *   - two rows put a long product name in a column the parser had to abandon,
 *     leaving a fragment;
 *   - one invoice abbreviates a monitor in the column the parser prefers, so it
 *     appeared as a second product at the same price. It is the same item.
 */
const CORRECTIONS: Record<string, string> = {
  'G10 15.6" Notebook - 5 - 7535U Win 11 Pro':
    'HP 255R G10 15.6" Notebook - AMD Ryzen 5 7535U Win 11 Pro 8GB RAM 256GB SSD',
  "HP ProDesk 2 SFF": "HP ProDesk 2 SFF G1iEi5 1350016GB/256GB PC",
  'AOC 27" Monitor': 'AOC 27P2Q 27" LED 1080p 75Hz Monitor',
};

const SERVICE_RE =
  /Managed Services|Migration Services|Software Development|qMechanic|Guides Collective|Support Hours|retention/i;
const LICENCE_RE = /Microsoft Office|Windows Server|RDS CALs|Volvo Software|Datto SIRIS/i;

type Line = { description: string; vat: string; quantity: number; unitPrice: number; amount: number };
type Invoice = { number: string; date: string; lines: Line[] };

function classify(name: string): "service" | "licence" | "hardware" {
  if (SERVICE_RE.test(name)) return "service";
  if (LICENCE_RE.test(name)) return "licence";
  return "hardware";
}

async function main() {
  const slug = flag("tenant") ?? "quantumharbour";
  const tenant = await findTenantBySlug(slug);
  if (!tenant) {
    console.error(`no tenant "${slug}"`);
    process.exit(1);
  }
  const invoices: Invoice[] = JSON.parse(
    readFileSync(join(__dirname, "invoices.json"), "utf8"),
  );

  // Aggregate the line items into candidate products.
  type Agg = {
    name: string;
    kind: "service" | "licence" | "hardware";
    qty: number;
    invoiced: number;
    history: { date: string; price: number }[];
    vat: Set<string>;
  };
  const agg = new Map<string, Agg>();
  for (const inv of invoices) {
    for (const l of inv.lines) {
      const name = CORRECTIONS[l.description.trim()] ?? l.description.trim();
      const a =
        agg.get(name) ??
        ({ name, kind: classify(name), qty: 0, invoiced: 0, history: [], vat: new Set() } as Agg);
      a.qty += l.quantity;
      a.invoiced = Math.round((a.invoiced + l.amount) * 100) / 100;
      a.history.push({ date: inv.date, price: l.unitPrice });
      a.vat.add(l.vat);
      agg.set(name, a);
    }
  }

  const wanted = [...agg.values()].filter(
    (a) =>
      a.kind === "hardware" ||
      (a.kind === "licence" && WITH_LICENCES) ||
      (a.kind === "services" as never) ||
      (a.kind === "service" && WITH_SERVICES),
  );

  console.log(
    `${COMMIT ? "COMMITTING to" : "DRY RUN against"} ${slug}\n` +
      `candidates: ${wanted.length} of ${agg.size} distinct line items ` +
      `(hardware${WITH_LICENCES ? " + licences" : ""}${WITH_SERVICES ? " + services" : ""})\n`,
  );

  await runInTenant({ tenantId: tenant.id, role: "owner", actor: "qh-products" }, async () => {
    const tid = tenantId();
    const scoped = (b: string) => `${tid}:${b}`;
    const existing = new Map(
      (await listProducts({ includeArchived: true })).map((p) => [p.name.toLowerCase(), p]),
    );

    // ---- 0. bring the stored line descriptions up to date ----
    //
    // The invoices were created from an earlier parse that truncated each
    // description at the first wrapped line ("AOC 27P2Q 27\" LED"). The parser
    // now reads the cell by column position and gets the whole thing, so the
    // stored lines are refreshed to match.
    //
    // Lines are matched by (invoice number, sortOrder), which is only safe if
    // the two parses produced the same lines in the same order — so quantity,
    // unit price and amount must all still agree before a description is
    // touched. Nothing about the money is written.
    const invByNumber = new Map(invoices.map((i) => [i.number, i]));
    const dbInvoices = await db
      .select({ id: schema.invoices.id, number: schema.invoices.number })
      .from(schema.invoices)
      .where(eq(schema.invoices.tenantId, tid));
    let refreshed = 0;
    let mismatched = 0;
    for (const dbInv of dbInvoices) {
      const parsedInv = invByNumber.get(dbInv.number);
      if (!parsedInv) continue;
      const dbLines = (
        await db
          .select()
          .from(schema.invoiceLines)
          .where(and(eq(schema.invoiceLines.tenantId, tid), eq(schema.invoiceLines.invoiceId, dbInv.id)))
      ).sort((a, b) => a.sortOrder - b.sortOrder);
      if (dbLines.length !== parsedInv.lines.length) {
        mismatched++;
        console.log(`   line count differs on ${dbInv.number}; left alone`);
        continue;
      }
      for (let i = 0; i < dbLines.length; i++) {
        const dbLine = dbLines[i];
        const fresh = parsedInv.lines[i];
        const agrees =
          Math.abs(dbLine.quantity - fresh.quantity) < 0.001 &&
          Math.abs(dbLine.unitPrice - fresh.unitPrice) < 0.005 &&
          // lineNet, not lineTotal: cashish stores lineTotal VAT-inclusive,
          // while the PDF's AMOUNT column is the net figure that sums to the
          // invoice subtotal.
          Math.abs(dbLine.lineNet - Math.round(fresh.amount * 100) / 100) < 0.02;
        if (!agrees) {
          mismatched++;
          continue;
        }
        const want = CORRECTIONS[fresh.description.trim()] ?? fresh.description.trim();
        if (want === dbLine.description) continue;
        if (COMMIT) {
          await db
            .update(schema.invoiceLines)
            .set({ description: want })
            .where(and(eq(schema.invoiceLines.tenantId, tid), eq(schema.invoiceLines.id, dbLine.id)));
        }
        refreshed++;
      }
    }
    console.log(
      `   ${COMMIT ? "refreshed" : "would refresh"} ${refreshed} line description(s)` +
        (mismatched ? `, ${mismatched} left alone (figures disagreed)` : ""),
    );



    let created = 0;
    const nameToId = new Map<string, string>();

    for (const a of wanted.sort((x, y) => y.invoiced - x.invoiced)) {
      const already = existing.get(a.name.toLowerCase());
      if (already) {
        nameToId.set(a.name, already.id);
        console.log(`   exists  ${a.name.slice(0, 66)}`);
        continue;
      }
      a.history.sort((p, q) => p.date.localeCompare(q.date));
      const latest = a.history[a.history.length - 1].price;
      const distinct = [...new Set(a.history.map((h) => h.price))];
      const description =
        distinct.length > 1
          ? `Price charged has varied: ${a.history
              .map((h) => `${h.date} €${h.price}`)
              .join(", ")}. Default is the most recent.`
          : "";

      const id = uid();
      nameToId.set(a.name, id);
      if (COMMIT) {
        await db.insert(schema.products).values({
          id,
          tenantId: tid,
          name: a.name,
          description,
          unitPrice: latest,
          // Every line on every invoice was standard-rated, so this is read off
          // the documents rather than assumed.
          vatRateId: scoped(a.vat.has("Export") ? "vat-zero" : "vat-standard"),
          kind: a.kind === "service" ? "service" : "good",
          incomeCategoryId: scoped("cat-sales"),
          sku: "",
        });
      }
      created++;
      console.log(
        `   ${COMMIT ? "created " : "would   "} ${String(latest).padStart(9)}  ` +
          `qty ${String(a.qty).padStart(3)}  ${a.name.slice(0, 58)}` +
          (distinct.length > 1 ? `   [price varied]` : ""),
      );
    }
    console.log(`\n   ${created} product(s)`);

    // ---- link the existing invoice lines to their product ----
    // Nothing about the money changes; this only fills in product_id so the
    // library is tied to the invoices it was derived from.
    const lines = await db
      .select()
      .from(schema.invoiceLines)
      .where(eq(schema.invoiceLines.tenantId, tid));
    let linked = 0;
    for (const l of lines) {
      if (l.productId) continue;
      const name = CORRECTIONS[l.description.trim()] ?? l.description.trim();
      const pid = nameToId.get(name);
      if (!pid) continue;
      if (COMMIT) {
        await db
          .update(schema.invoiceLines)
          .set({ productId: pid })
          .where(and(eq(schema.invoiceLines.tenantId, tid), eq(schema.invoiceLines.id, l.id)));
      }
      linked++;
    }
    console.log(`   ${COMMIT ? "linked" : "would link"} ${linked} of ${lines.length} invoice lines`);

    const skipped = [...agg.values()].filter((a) => !wanted.includes(a));
    if (skipped.length) {
      console.log(`\n   not created (${skipped.length}):`);
      for (const s of skipped.sort((x, y) => y.invoiced - x.invoiced)) {
        console.log(`     ${s.kind.padEnd(8)} ${String(s.invoiced).padStart(10)}  ${s.name.slice(0, 58)}`);
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
