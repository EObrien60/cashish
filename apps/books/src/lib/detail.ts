import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, first, schema, tenantId } from "@cashish/core/db";
import { round2 } from "./format";

const { customers, products, invoices, invoiceLines, payments, transactions, categories, vatRates } =
  schema;

// ---------------------------------------------------------------------------
// Read models for the customer and product detail screens.
//
// Both answer the same question from opposite ends — "what has this thing been
// involved in?" — and both are assembled here rather than in the page, so the
// tenant filter lives in one place and the pages stay presentational.
// ---------------------------------------------------------------------------

export type CustomerDetail = NonNullable<Awaited<ReturnType<typeof getCustomerDetail>>>;

export async function getCustomerDetail(id: string) {
  const tid = tenantId();
  const customer = first(
    await db
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, tid), eq(customers.id, id)))
      .limit(1),
  );
  if (!customer) return null;

  const [invoiceRows, paymentRows] = await Promise.all([
    db
      .select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, tid), eq(invoices.customerId, id)))
      .orderBy(desc(invoices.issueDate)),
    // Both sides scoped: joining on invoice alone would let another tenant's
    // payments in through a shared invoice id.
    db
      .select({
        id: payments.id,
        date: payments.date,
        amount: payments.amount,
        method: payments.method,
        note: payments.note,
        transactionId: payments.transactionId,
        invoiceId: payments.invoiceId,
        invoiceNumber: invoices.number,
      })
      .from(payments)
      .innerJoin(invoices, and(eq(payments.invoiceId, invoices.id), eq(invoices.tenantId, tid)))
      .where(and(eq(payments.tenantId, tid), eq(invoices.customerId, id)))
      .orderBy(desc(payments.date)),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const live = invoiceRows.filter((i) => i.status !== "void");
  let outstanding = 0;
  let overdue = 0;
  let worstDaysOverdue = 0;
  for (const inv of live) {
    const owed = round2(inv.total - inv.amountPaid);
    if (owed <= 0.005) continue;
    outstanding += owed;
    if (inv.dueDate && inv.dueDate < today) {
      overdue += owed;
      const days = Math.round(
        (Date.parse(today) - Date.parse(inv.dueDate)) / 86_400_000,
      );
      worstDaysOverdue = Math.max(worstDaysOverdue, days);
    }
  }

  /** What this customer has actually bought, by product, across every invoice. */
  const bought = await db
    .select({
      productId: invoiceLines.productId,
      description: invoiceLines.description,
      quantity: sql<string>`sum(${invoiceLines.quantity})`,
      net: sql<string>`sum(${invoiceLines.lineNet})`,
      lines: sql<string>`count(*)`,
    })
    .from(invoiceLines)
    .innerJoin(invoices, and(eq(invoiceLines.invoiceId, invoices.id), eq(invoices.tenantId, tid)))
    .where(and(eq(invoiceLines.tenantId, tid), eq(invoices.customerId, id)))
    .groupBy(invoiceLines.productId, invoiceLines.description)
    .orderBy(desc(sql`sum(${invoiceLines.lineNet})`));

  return {
    customer,
    invoices: invoiceRows.map((i) => ({ ...i, outstanding: round2(i.total - i.amountPaid) })),
    payments: paymentRows,
    totals: {
      invoiced: round2(live.reduce((s, i) => s + i.total, 0)),
      received: round2(live.reduce((s, i) => s + i.amountPaid, 0)),
      outstanding: round2(outstanding),
      overdue: round2(overdue),
      worstDaysOverdue,
      invoiceCount: invoiceRows.length,
      openCount: live.filter((i) => round2(i.total - i.amountPaid) > 0.005).length,
    },
    // count() and sum() arrive as strings from Postgres; coerce at the boundary.
    bought: bought.map((b) => ({
      productId: b.productId,
      description: b.description,
      quantity: Number(b.quantity),
      net: round2(Number(b.net)),
      lines: Number(b.lines),
    })),
  };
}

export type ProductDetail = NonNullable<Awaited<ReturnType<typeof getProductDetail>>>;

export async function getProductDetail(id: string) {
  const tid = tenantId();
  const product = first(
    await db
      .select()
      .from(products)
      .where(and(eq(products.tenantId, tid), eq(products.id, id)))
      .limit(1),
  );
  if (!product) return null;

  const [vat, category] = await Promise.all([
    product.vatRateId
      ? db
          .select()
          .from(vatRates)
          .where(and(eq(vatRates.tenantId, tid), eq(vatRates.id, product.vatRateId)))
          .limit(1)
          .then(first)
      : Promise.resolve(null),
    product.incomeCategoryId
      ? db
          .select()
          .from(categories)
          .where(and(eq(categories.tenantId, tid), eq(categories.id, product.incomeCategoryId)))
          .limit(1)
          .then(first)
      : Promise.resolve(null),
  ]);

  /** Every line this product appears on, with the invoice and customer around it. */
  const lines = await db
    .select({
      lineId: invoiceLines.id,
      description: invoiceLines.description,
      quantity: invoiceLines.quantity,
      unitPrice: invoiceLines.unitPrice,
      lineNet: invoiceLines.lineNet,
      lineVat: invoiceLines.lineVat,
      invoiceId: invoices.id,
      number: invoices.number,
      issueDate: invoices.issueDate,
      status: invoices.status,
      customerId: customers.id,
      customerName: customers.name,
    })
    .from(invoiceLines)
    .innerJoin(invoices, and(eq(invoiceLines.invoiceId, invoices.id), eq(invoices.tenantId, tid)))
    .innerJoin(customers, and(eq(invoices.customerId, customers.id), eq(customers.tenantId, tid)))
    .where(and(eq(invoiceLines.tenantId, tid), eq(invoiceLines.productId, id)))
    .orderBy(desc(invoices.issueDate));

  const sold = lines.reduce((s, l) => s + l.quantity, 0);
  const net = round2(lines.reduce((s, l) => s + l.lineNet, 0));

  // Price history, oldest first — the honest answer to "what do we charge for
  // this?" when it has changed.
  const priceHistory = [...lines]
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate))
    .map((l) => ({ date: l.issueDate, number: l.number, unitPrice: l.unitPrice }));
  const distinctPrices = [...new Set(priceHistory.map((p) => p.unitPrice))];

  const byCustomer = new Map<string, { id: string; name: string; quantity: number; net: number }>();
  for (const l of lines) {
    const c =
      byCustomer.get(l.customerId) ?? { id: l.customerId, name: l.customerName, quantity: 0, net: 0 };
    c.quantity += l.quantity;
    c.net = round2(c.net + l.lineNet);
    byCustomer.set(l.customerId, c);
  }

  return {
    product,
    vat,
    category,
    lines,
    totals: {
      unitsSold: sold,
      net,
      invoiceCount: new Set(lines.map((l) => l.invoiceId)).size,
      customerCount: byCustomer.size,
      averagePrice: sold > 0 ? round2(net / sold) : 0,
    },
    priceHistory,
    priceVaried: distinctPrices.length > 1,
    byCustomer: [...byCustomer.values()].sort((a, b) => b.net - a.net),
  };
}

/** Product rows with usage attached, for the list view. */
export async function listProductsWithUsage() {
  const tid = tenantId();
  const rows = await db
    .select({
      productId: invoiceLines.productId,
      units: sql<string>`sum(${invoiceLines.quantity})`,
      net: sql<string>`sum(${invoiceLines.lineNet})`,
      lines: sql<string>`count(*)`,
    })
    .from(invoiceLines)
    .where(and(eq(invoiceLines.tenantId, tid), sql`${invoiceLines.productId} IS NOT NULL`))
    .groupBy(invoiceLines.productId);
  return new Map(
    rows.map((r) => [
      r.productId as string,
      { units: Number(r.units), net: round2(Number(r.net)), lines: Number(r.lines) },
    ]),
  );
}

/** Customer rows with invoice totals attached, for the list view. */
export async function listCustomerTotals() {
  const tid = tenantId();
  const rows = await db
    .select({
      customerId: invoices.customerId,
      invoiced: sql<string>`sum(${invoices.total})`,
      paid: sql<string>`sum(${invoices.amountPaid})`,
      count: sql<string>`count(*)`,
    })
    .from(invoices)
    .where(and(eq(invoices.tenantId, tid), sql`${invoices.status} <> 'void'`))
    .groupBy(invoices.customerId);
  return new Map(
    rows.map((r) => [
      r.customerId,
      {
        invoiced: round2(Number(r.invoiced)),
        paid: round2(Number(r.paid)),
        outstanding: round2(Number(r.invoiced) - Number(r.paid)),
        count: Number(r.count),
      },
    ]),
  );
}
