import { db, schema, tenantId } from "@cashish/core/db";
import { and, gte, lte, isNotNull, isNull, eq } from "drizzle-orm";
import { round2 } from "./format";
import { notExcluded } from "./transactions";

const { payments, invoices, transactions, vatRates, categories } = schema;

export type VatReturn = {
  from: string;
  to: string;
  basis: "cash" | "invoice";
  // VAT3 boxes
  t1_salesVat: number; // VAT on sales
  t2_purchasesVat: number; // VAT on purchases
  t3_payable: number; // if T1 > T2
  t4_repayable: number; // if T2 > T1
  // supporting figures
  netSales: number; // ex-VAT value of sales recognised
  netPurchases: number; // ex-VAT value of purchases with VAT
  salesByRate: RateRow[];
  purchasesByRate: RateRow[];
  unassignedExpenseCount: number; // expenses with no category — possible missed VAT
};

export type RateRow = { rateId: string; name: string; rate: number; net: number; vat: number };

// Cash basis: output VAT is recognised when the customer pays. We apportion
// each payment by the invoice's VAT-to-total ratio (handles part-payments and
// mixed-rate invoices proportionally — the pragmatic Revenue-accepted method).
async function salesVat(from: string, to: string) {
  const tid = tenantId();
  const rows = await db
    .select({
      payAmount: payments.amount,
      invTotal: invoices.total,
      invVat: invoices.vatTotal,
      invSub: invoices.subtotal,
      status: invoices.status,
    })
    .from(payments)
    // Both sides of the join are scoped: a join is the one place where filtering
    // only the driving table would let another tenant's rows in.
    .innerJoin(
      invoices,
      and(eq(payments.invoiceId, invoices.id), eq(invoices.tenantId, tid)),
    )
    .where(and(eq(payments.tenantId, tid), gte(payments.date, from), lte(payments.date, to)));

  let vat = 0;
  let net = 0;
  for (const r of rows) {
    if (r.status === "void") continue;
    if (!r.invTotal || r.invTotal === 0) continue;
    const vatPortion = round2(r.payAmount * (r.invVat / r.invTotal));
    const netPortion = round2(r.payAmount - vatPortion);
    vat += vatPortion;
    net += netPortion;
  }
  return { vat: round2(vat), net: round2(net) };
}

// Input VAT from expense bank transactions tagged with a VAT rate. The tx
// amount is VAT-inclusive (gross), so the VAT element = gross * r/(1+r).
async function purchasesVat(from: string, to: string) {
  const tid = tenantId();
  const [rows, rateRows] = await Promise.all([
    db
      .select({
        amount: transactions.amount,
        vatRateId: transactions.vatRateId,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.tenantId, tid),
          gte(transactions.bookedDate, from),
          lte(transactions.bookedDate, to),
          isNotNull(transactions.vatRateId),
          notExcluded(),
        ),
      ),
    db.select().from(vatRates).where(eq(vatRates.tenantId, tid)),
  ]);

  const rateMap = new Map(rateRows.map((r) => [r.id, r]));
  let vat = 0;
  let net = 0;
  const byRate = new Map<string, RateRow>();
  for (const row of rows) {
    if (row.amount >= 0) continue; // only money out = purchases
    const vr = row.vatRateId ? rateMap.get(row.vatRateId) : undefined;
    if (!vr) continue;
    const gross = Math.abs(row.amount);
    const v = vr.rate > 0 ? round2(gross * (vr.rate / (1 + vr.rate))) : 0;
    const n = round2(gross - v);
    vat += v;
    net += n;
    const cur = byRate.get(vr.id) ?? {
      rateId: vr.id,
      name: vr.name,
      rate: vr.rate,
      net: 0,
      vat: 0,
    };
    cur.net = round2(cur.net + n);
    cur.vat = round2(cur.vat + v);
    byRate.set(vr.id, cur);
  }
  return { vat: round2(vat), net: round2(net), byRate: [...byRate.values()] };
}

async function salesByRate(from: string, to: string): Promise<RateRow[]> {
  const tid = tenantId();
  const rows = await db
    .select({
      payAmount: payments.amount,
      invTotal: invoices.total,
      invVat: invoices.vatTotal,
      status: invoices.status,
    })
    .from(payments)
    .innerJoin(
      invoices,
      and(eq(payments.invoiceId, invoices.id), eq(invoices.tenantId, tid)),
    )
    .where(and(eq(payments.tenantId, tid), gte(payments.date, from), lte(payments.date, to)));
  // We don't store per-payment rate split, so report blended at standard rate
  // bucket. Good enough for the VAT3 headline; detailed RTD can come later.
  let net = 0;
  let vat = 0;
  for (const r of rows) {
    if (r.status === "void" || !r.invTotal) continue;
    const v = round2(r.payAmount * (r.invVat / r.invTotal));
    vat += v;
    net += round2(r.payAmount - v);
  }
  if (net === 0 && vat === 0) return [];
  return [{ rateId: "sales", name: "Sales (cash received)", rate: 0, net: round2(net), vat: round2(vat) }];
}

export async function computeVatReturn(from: string, to: string): Promise<VatReturn> {
  const tid = tenantId();

  // Expenses with neither a category nor a VAT rate: possible missed input VAT.
  //
  // This previously ran two near-identical full-range queries and threw the
  // first result away unused, then counted in JS. One filtered count instead.
  const [sales, purch, rates, unassignedRows] = await Promise.all([
    salesVat(from, to),
    purchasesVat(from, to),
    salesByRate(from, to),
    db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.tenantId, tid),
          gte(transactions.bookedDate, from),
          lte(transactions.bookedDate, to),
          lte(transactions.amount, -0.005),
          isNull(transactions.categoryId),
          isNull(transactions.vatRateId),
          notExcluded(),
        ),
      ),
  ]);
  const unassignedExpenseCount = unassignedRows.length;

  const t1 = sales.vat;
  const t2 = purch.vat;
  return {
    from,
    to,
    basis: "cash",
    t1_salesVat: t1,
    t2_purchasesVat: t2,
    t3_payable: round2(Math.max(0, t1 - t2)),
    t4_repayable: round2(Math.max(0, t2 - t1)),
    netSales: sales.net,
    netPurchases: purch.net,
    salesByRate: rates,
    purchasesByRate: purch.byRate,
    unassignedExpenseCount,
  };
}
