#!/usr/bin/env tsx
/**
 * Records payments against QuantumHarbour's invoices from the bank feed.
 *
 *   npx tsx scripts/qh/match-payments.ts --tenant quantumharbour [--commit]
 *
 * Only exact-amount matches are recorded, each linked to the bank line that
 * explains it and dated from that line. Partial and combined settlements are
 * left for a person: an inflow of €4,280.40 against a €1,525.20 invoice is
 * probably several invoices at once, and guessing which would put wrong dates
 * on a cash-basis VAT return.
 *
 * Two payer aliases, both established from the documents rather than assumed:
 *
 *   GUSTO, INC.      -> TripleBolt   (three inflows totalling exactly the
 *                                     €27,000 of invoices 1057, 1063, 1064)
 *   SAOITHE TEORANTA -> Barrowview   (four inflows matching invoices 1012,
 *                                     1054, 1055 and 1056 to the cent)
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { db, pool, runInTenant, schema, tenantId } from "@cashish/core/db";
import { findTenantBySlug } from "../../src/db/seed";
import { listInvoices, recordPayment, getInvoice } from "../../src/lib/invoices";
import { listCustomers } from "../../src/lib/customers";
import { listTransactions } from "../../src/lib/transactions";
import { round2 } from "../../src/lib/format";

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 ? args[i + 1] : undefined;
};
const COMMIT = args.includes("--commit");

/** Bank-statement counterparty text -> the customer it is paying for. */
const PAYER_ALIASES: { match: string; customer: string }[] = [
  { match: "GUSTO", customer: "TripleBolt" },
  { match: "SAOITHE", customer: "Barrowview Medical Practice" },
  { match: "J. RYAN HAULAGE", customer: "J Ryan Haulage Limited" },
  { match: "J RYAN HAULAGE", customer: "J Ryan Haulage Limited" },
  { match: "BARROWVIEW", customer: "Barrowview Medical Practice" },
  { match: "O'BRIEN HUGHES", customer: "O'Brien Hughes Software Consulting Limited" },
  { match: "OBRIEN HUGHES", customer: "O'Brien Hughes Software Consulting Limited" },
];

const TOLERANCE = 0.02;

async function main() {
  const slug = flag("tenant") ?? "quantumharbour";
  const tenant = await findTenantBySlug(slug);
  if (!tenant) {
    console.error(`no tenant "${slug}"`);
    process.exit(1);
  }

  console.log(`${COMMIT ? "COMMITTING to" : "DRY RUN against"} ${slug}\n`);

  await runInTenant({ tenantId: tenant.id, role: "owner", actor: "qh-match" }, async () => {
    const tid = tenantId();
    const customers = await listCustomers({ includeArchived: true });
    const byId = new Map(customers.map((c) => [c.id, c]));

    // Bank lines already linked to a payment must not be spent twice.
    const linked = new Set(
      (
        await db
          .select({ t: schema.payments.transactionId })
          .from(schema.payments)
          .where(and(eq(schema.payments.tenantId, tid), isNotNull(schema.payments.transactionId)))
      ).map((r) => r.t as string),
    );

    const inflows = (await listTransactions({ direction: "in" }))
      .filter((t) => !linked.has(t.id))
      .sort((a, b) => a.bookedDate.localeCompare(b.bookedDate)); // oldest money first

    // Outstanding invoices, oldest first, so the earliest debt settles first.
    const invoices = (await listInvoices())
      .filter((i) => i.status !== "void" && round2(i.total - i.amountPaid) > 0.005)
      .sort((a, b) => a.issueDate.localeCompare(b.issueDate));

    const claimed = new Set<string>();
    const matched: { tx: string; date: string; amount: number; number: string; who: string }[] = [];

    for (const tx of inflows) {
      const text = `${tx.description ?? ""} ${tx.reference ?? ""} ${tx.payer ?? ""}`.toUpperCase();
      const alias = PAYER_ALIASES.find((a) => text.includes(a.match));
      if (!alias) continue;

      const candidate = invoices.find((inv) => {
        if (claimed.has(inv.id)) return false;
        // An invoice cannot be settled by money that arrived before it existed.
        if (tx.bookedDate < inv.issueDate) return false;
        if (byId.get(inv.customerId)?.name !== alias.customer) return false;
        return Math.abs(round2(inv.total - inv.amountPaid) - tx.amount) <= TOLERANCE;
      });
      if (!candidate) continue;

      claimed.add(candidate.id);
      matched.push({
        tx: tx.id,
        date: tx.bookedDate,
        amount: round2(tx.amount),
        number: candidate.number,
        who: alias.customer,
      });

      if (COMMIT) {
        await recordPayment(candidate.id, {
          date: tx.bookedDate,
          amount: round2(tx.amount),
          method: "bank",
          transactionId: tx.id,
          note: `Matched from bank: ${(tx.description ?? "").slice(0, 60)}`,
        });
      }
    }

    console.log(`${COMMIT ? "recorded" : "would record"} ${matched.length} payment(s)`);
    for (const m of matched) {
      console.log(`  ${m.date}  ${String(m.amount).padStart(10)}  -> ${m.number}  ${m.who}`);
    }

    const stillOpen = invoices.filter((i) => !claimed.has(i.id));
    const openTotal = round2(stillOpen.reduce((s, i) => s + (i.total - i.amountPaid), 0));
    console.log(`\nstill open: ${stillOpen.length} invoice(s), ${openTotal}`);
    for (const i of stillOpen) {
      console.log(
        `  ${i.number}  ${i.issueDate}  ${String(round2(i.total - i.amountPaid)).padStart(10)}  ` +
          `${byId.get(i.customerId)?.name.slice(0, 34)}`,
      );
    }
  });

  await pool.end();
}

main().catch(async (e) => {
  console.error("failed:", e);
  await pool.end().catch(() => {});
  process.exit(1);
});
