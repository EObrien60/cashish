/**
 * Repair a customer whose batch payments were mis-allocated.
 *
 * Before batch matching existed, the reconciler bound one bank line to at most one
 * invoice. A client who settles several invoices in one transfer therefore produced
 * transfers that could never match — and worse, because their retainer invoices are
 * identical, the transfers that DID match a single amount were handed to the oldest
 * unclaimed retainer, one an earlier batch had already paid. The money landed on the
 * wrong invoices and the ones it really settled stayed open.
 *
 * This undoes that and re-applies the corrected allocation. It does not trust the
 * matcher blindly: the expected plan is stated below, and the script refuses to write
 * anything unless what the matcher proposes is exactly that.
 *
 *   npx tsx scripts/qh/repair-batch-payments.ts --tenant quantumharbour            # dry run
 *   npx tsx scripts/qh/repair-batch-payments.ts --tenant quantumharbour --commit
 *
 * Idempotent: with the allocation already correct there is nothing to undo and nothing
 * to propose, and it exits saying so.
 */
import { and, eq } from "drizzle-orm";
import { runInTenant } from "../../src/db/context";
import { findTenantBySlug } from "../../src/db/seed";
import { db, pool, schema } from "../../src/db/client";
import { round2 } from "../../src/lib/format";
import { listCustomers } from "../../src/lib/customers";
import { deletePayment, getInvoice } from "../../src/lib/invoices";
import { applyBatchMatch, reconcileReport } from "../../src/lib/reconcile";

const { invoices, payments, transactions } = schema;

const arg = (name: string, fallback = "") => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? "") : fallback;
};
const has = (name: string) => process.argv.includes(`--${name}`);

const CUSTOMER = arg("customer", "J Ryan Haulage Limited");

/** Payments to undo: invoices an earlier batch had already settled. */
const UNDO_INVOICES = ["1013", "1053"];

/**
 * The allocation the fixed matcher must propose, established from the ledger: the
 * invoices on file excluding the newest come to 39,220.99 and 39,220.90 arrived, so
 * every invoice but the newest is paid, nine cent short on one batch.
 */
const EXPECTED_BATCHES: { date: string; amount: number; invoices: string[] }[] = [
  { date: "2025-07-30", amount: 3669.0, invoices: ["1010", "1011", "1013"] },
  { date: "2025-08-27", amount: 2170.95, invoices: ["1052", "1053"] },
  { date: "2025-10-02", amount: 2904.01, invoices: ["1058", "1059"] },
];
const EXPECTED_SINGLES: { date: string; invoice: string }[] = [
  { date: "2025-11-26", invoice: "1061" },
  { date: "2025-12-17", invoice: "1062" },
];
/** Left open on purpose: the most recent invoice, genuinely unpaid. */
const EXPECTED_STILL_OPEN = ["1071"];

const key = (list: string[]) => [...list].sort().join("+");

async function main() {
  const slug = arg("tenant");
  if (!slug) throw new Error("--tenant <slug> required");
  const commit = has("commit");
  const tenant = await findTenantBySlug(slug);
  if (!tenant) throw new Error(`No tenant ${slug}`);

  await runInTenant({ tenantId: tenant.id, role: "owner", actor: "repair-batch-payments" }, async () => {
    const customer = (await listCustomers({ includeArchived: true })).find((c) => c.name === CUSTOMER);
    if (!customer) throw new Error(`No customer named ${CUSTOMER} in ${slug}`);

    const mine = async () =>
      (await db.select().from(invoices).where(and(eq(invoices.tenantId, tenant.id), eq(invoices.customerId, customer.id))))
        .sort((a, b) => a.issueDate.localeCompare(b.issueDate));

    const before = await mine();
    const openBefore = before.filter((i) => round2(i.total - i.amountPaid) > 0.005);
    console.log(`${slug} / ${CUSTOMER}`);
    console.log(`  ${before.length} invoices, ${round2(before.reduce((s, i) => s + i.total, 0))} invoiced`);
    console.log(
      `  currently open: ${openBefore.length} / ${round2(openBefore.reduce((s, i) => s + i.total - i.amountPaid, 0))}`,
    );
    console.log(`     ${openBefore.map((i) => i.number).join(", ") || "none"}`);

    /*
     * Is this ledger already repaired?
     *
     * It has to be asked before anything is deleted. Once a batch is written, its
     * transaction has payments linked to it, so it is no longer an unmatched inflow and
     * the matcher will not propose it again. Undoing part of a repaired batch therefore
     * cannot be undone in turn — the invoices would be stripped back to open with no way
     * to rebuild them. So: recognise the repaired state and stop.
     */
    const paymentsOn = async (invoiceId: string) =>
      db
        .select()
        .from(payments)
        .where(and(eq(payments.tenantId, tenant.id), eq(payments.invoiceId, invoiceId)));

    const numberOf = new Map(before.map((i) => [i.id, i.number]));
    const idOf = new Map(before.map((i) => [i.number, i.id]));
    const allPayments = await db
      .select()
      .from(payments)
      .where(eq(payments.tenantId, tenant.id));
    const txIds = new Map<string, string[]>(); // transactionId -> invoice numbers
    for (const row of allPayments) {
      const number = numberOf.get(row.invoiceId);
      if (!number || !row.transactionId) continue;
      txIds.set(row.transactionId, [...(txIds.get(row.transactionId) ?? []), number]);
    }
    const txRows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.tenantId, tenant.id));
    const txOn = (date: string, amount: number) =>
      txRows.find((t) => t.bookedDate === date && Math.abs(t.amount - amount) < 0.005);

    const batchState = EXPECTED_BATCHES.map((expected) => {
      const tx = txOn(expected.date, expected.amount);
      const settled = tx ? (txIds.get(tx.id) ?? []) : [];
      return { expected, tx, settled, done: key(settled) === key(expected.invoices) };
    });
    const missingTx = batchState.filter((b) => !b.tx);
    if (missingTx.length) {
      throw new Error(
        `cannot find the bank line for ${missingTx.map((b) => `${b.expected.date} ${b.expected.amount}`).join(", ")} — wrong tenant or customer?`,
      );
    }
    if (batchState.every((b) => b.done)) {
      console.log("\nAlready repaired: every batch transfer is linked to exactly the invoices it settles.");
      console.log("  " + batchState.map((b) => `${b.expected.date} -> ${key(b.settled)}`).join("\n  "));
      return;
    }
    const partly = batchState.filter((b) => b.settled.length && !b.done);
    if (partly.length) {
      console.error("\nREFUSING: some batch transfers are partly linked, which is neither the broken state nor the repaired one.");
      for (const b of partly) console.error(`  ${b.expected.date}: linked to ${key(b.settled)}, expected ${key(b.expected.invoices)}`);
      console.error("  Sort these out by hand — this script only knows how to convert the original one-to-one mistake.");
      process.exitCode = 1;
      return;
    }

    /*
     * Step one: undo the payments that landed on invoices an earlier batch had paid.
     * Only a payment whose bank line settles nothing else qualifies — that is the
     * signature of the one-to-one mistake, and it keeps this from touching a good row.
     */
    const doomed = [];
    for (const number of UNDO_INVOICES) {
      const invoiceId = idOf.get(number);
      if (!invoiceId) throw new Error(`No invoice ${number} — is this the right customer?`);
      for (const row of await paymentsOn(invoiceId)) {
        const alsoOnThatLine = (txIds.get(row.transactionId ?? "") ?? []).filter((n) => n !== number);
        if (alsoOnThatLine.length) {
          console.error(
            `REFUSING: the payment on ${number} shares its bank line with ${alsoOnThatLine.join(", ")}, so it is not the one-to-one mistake.`,
          );
          process.exitCode = 1;
          return;
        }
        doomed.push({ number, id: row.id, date: row.date, amount: row.amount });
      }
    }
    console.log(`\nto undo: ${doomed.length} payment(s)`);
    for (const d of doomed) console.log(`  ${d.number}  ${d.date}  ${d.amount}`);

    if (!doomed.length) {
      console.log("\nNothing to undo, and the batches are not written either — investigate by hand.");
      process.exitCode = 1;
      return;
    }

    if (!commit) {
      console.log("\n(dry run) would remove those, then re-reconcile and write:");
      for (const b of EXPECTED_BATCHES) console.log(`  batch  ${b.date} ${String(b.amount).padStart(9)} -> ${b.invoices.join(" + ")}`);
      for (const single of EXPECTED_SINGLES) console.log(`  single ${single.date} -> ${single.invoice}`);
      console.log("\nNothing written. Re-run with --commit.");
      return;
    }

    for (const d of doomed) await deletePayment(d.id);
    console.log("  removed.");

    /* Step two: what the fixed matcher now proposes. */
    const report = await reconcileReport();
    const numbersFor = (ids: string[]) =>
      ids.map((id) => before.find((i) => i.id === id)?.number ?? "?");

    const proposedBatches = report.batchMatches
      .filter((b) => b.invoices.every((i) => i.customerId === customer.id))
      .map((b) => ({
        date: b.transaction.date,
        amount: b.transaction.amount,
        invoices: numbersFor(b.invoices.map((i) => i.invoiceId)),
        shortfall: b.shortfall,
        txId: b.transaction.id,
        ids: b.invoices.map((i) => i.invoiceId),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const proposedSingles = report.confidentMatches
      .filter((m) => m.candidates[0]?.customerId === customer.id)
      .map((m) => ({
        date: m.transaction.date,
        invoice: numbersFor([m.candidates[0]!.invoiceId])[0]!,
        invoiceId: m.candidates[0]!.invoiceId,
        txId: m.transaction.id,
        amount: m.transaction.amount,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    console.log("\nproposed:");
    for (const b of proposedBatches) {
      console.log(`  batch  ${b.date} ${String(b.amount).padStart(9)} -> ${b.invoices.join(" + ")}${b.shortfall ? `  (${b.shortfall} short)` : ""}`);
    }
    for (const s of proposedSingles) console.log(`  single ${s.date} ${String(s.amount).padStart(9)} -> ${s.invoice}`);

    /* Step three: refuse unless it is exactly the plan. */
    const mismatch: string[] = [];
    if (proposedBatches.length !== EXPECTED_BATCHES.length) {
      mismatch.push(`expected ${EXPECTED_BATCHES.length} batches, got ${proposedBatches.length}`);
    }
    for (const [i, expected] of EXPECTED_BATCHES.entries()) {
      const got = proposedBatches[i];
      if (!got) { mismatch.push(`missing batch ${expected.date}`); continue; }
      if (got.date !== expected.date) mismatch.push(`batch ${i}: date ${got.date} != ${expected.date}`);
      if (Math.abs(got.amount - expected.amount) > 0.005) mismatch.push(`batch ${expected.date}: amount ${got.amount} != ${expected.amount}`);
      if (key(got.invoices) !== key(expected.invoices)) {
        mismatch.push(`batch ${expected.date}: ${key(got.invoices)} != ${key(expected.invoices)}`);
      }
    }
    for (const expected of EXPECTED_SINGLES) {
      const got = proposedSingles.find((s) => s.date === expected.date);
      if (!got) { mismatch.push(`missing single ${expected.date}`); continue; }
      if (got.invoice !== expected.invoice) mismatch.push(`single ${expected.date}: ${got.invoice} != ${expected.invoice}`);
    }
    if (mismatch.length) {
      console.error("\nREFUSING TO WRITE — the matcher does not propose the stated plan:");
      for (const m of mismatch) console.error(`  ${m}`);
      console.error("\nThe two payments were removed but nothing was re-applied. Investigate before re-running.");
      process.exitCode = 1;
      return;
    }

    /* Step four: write it. */
    console.log("\nplan matches. writing:");
    for (const b of proposedBatches) {
      const result = await applyBatchMatch(b.txId, b.ids, {
        note: `One transfer settling ${b.invoices.length} invoices`,
      });
      console.log(`  batch  ${b.date} -> ${result.written.map((w) => `${w.number} ${w.amount}`).join(", ")}${result.unallocated ? `  (${result.unallocated} unallocated)` : ""}`);
    }
    const { recordPayment } = await import("../../src/lib/invoices");
    for (const s of proposedSingles) {
      await recordPayment(s.invoiceId, { date: s.date, amount: s.amount, method: "bank", transactionId: s.txId });
      console.log(`  single ${s.date} -> ${s.invoice} ${s.amount}`);
    }

    /* Step five: prove it. */
    const after = await mine();
    const openAfter = after.filter((i) => round2(i.total - i.amountPaid) > 0.005);
    const received = round2(after.reduce((s, i) => s + i.amountPaid, 0));
    console.log(`\nafter:`);
    console.log(`  received  ${received}`);
    console.log(`  still open ${openAfter.length} / ${round2(openAfter.reduce((s, i) => s + i.total - i.amountPaid, 0))}`);
    for (const i of openAfter) {
      console.log(`     ${i.number} ${i.issueDate} ${round2(i.total - i.amountPaid)} ${i.status}`);
    }
    const unexpected = openAfter.filter((i) => !EXPECTED_STILL_OPEN.includes(i.number) && round2(i.total - i.amountPaid) > 0.5);
    if (unexpected.length) {
      console.error(`  UNEXPECTED still open: ${unexpected.map((i) => i.number).join(", ")}`);
      process.exitCode = 1;
    } else {
      console.log(`  as expected: only ${EXPECTED_STILL_OPEN.join(", ")} outstanding (plus any rounding remainder).`);
    }
  });

  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exitCode = 1;
});
