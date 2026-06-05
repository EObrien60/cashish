import { boot } from "@/lib/boot";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { getInvoice } from "@/lib/invoices";
import { money, fmtDate, pct, round2 } from "@/lib/format";
import { Card, StatusBadge } from "@/components/ui";
import { InvoiceActions } from "@/components/InvoiceActions";
import { notFound } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function InvoiceViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  boot();
  const { id } = await params;
  const inv = getInvoice(id);
  if (!inv) notFound();

  const settings = db.select().from(schema.settings).where(eq(schema.settings.id, 1)).get();
  const customer = db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.id, inv.customerId))
    .get();
  const vatRates = new Map(db.select().from(schema.vatRates).all().map((v) => [v.id, v]));

  // VAT breakdown by rate
  const breakdown = new Map<string, { label: string; net: number; vat: number }>();
  for (const l of inv.lines) {
    const key = l.vatRateId ?? "none";
    const label = l.vatRateId
      ? (vatRates.get(l.vatRateId)?.name ?? pct(l.vatRate))
      : "No VAT";
    const cur = breakdown.get(key) ?? { label, net: 0, vat: 0 };
    cur.net = round2(cur.net + l.lineNet);
    cur.vat = round2(cur.vat + l.lineVat);
    breakdown.set(key, cur);
  }

  const today = new Date().toISOString().slice(0, 10);
  const due = round2(inv.total - inv.amountPaid);
  const overdue =
    inv.dueDate && inv.dueDate < today && due > 0.005 && inv.status !== "void" && inv.status !== "draft";

  return (
    <div>
      <div className="no-print mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/invoices" className="text-sm text-ink-faint hover:text-ink">
            ← Invoices
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">{inv.number}</h1>
          <StatusBadge status={overdue ? "overdue" : inv.status} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Printable sheet */}
        <Card className="print-sheet p-8 lg:col-span-2">
          <div className="flex items-start justify-between gap-6">
            <div>
              {settings?.logoDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={settings.logoDataUrl}
                  alt=""
                  className="mb-3 max-h-16"
                />
              ) : (
                <div className="text-xl font-bold text-brand">
                  {settings?.businessName}
                </div>
              )}
              <div className="mt-1 text-sm text-ink-soft leading-relaxed">
                {settings?.addressLine1 && <div>{settings.addressLine1}</div>}
                {settings?.addressLine2 && <div>{settings.addressLine2}</div>}
                {settings?.city && <div>{settings.city}</div>}
                {settings?.country && <div>{settings.country}</div>}
                {settings?.vatNumber && (
                  <div className="mt-1">VAT: {settings.vatNumber}</div>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold tracking-tight">INVOICE</div>
              <div className="mt-1 text-sm tabular text-ink-soft">
                {inv.number}
              </div>
              <div className="mt-4 text-sm">
                <div className="flex justify-end gap-3">
                  <span className="text-ink-faint">Issued</span>
                  <span className="tabular w-24 text-right">
                    {fmtDate(inv.issueDate)}
                  </span>
                </div>
                <div className="flex justify-end gap-3">
                  <span className="text-ink-faint">Due</span>
                  <span className="tabular w-24 text-right">
                    {fmtDate(inv.dueDate)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Bill to
            </div>
            <div className="mt-1 text-sm">
              <div className="font-semibold text-ink">{customer?.name}</div>
              {customer?.addressLine1 && <div>{customer.addressLine1}</div>}
              {customer?.addressLine2 && <div>{customer.addressLine2}</div>}
              {customer?.city && <div>{customer.city}</div>}
              {customer?.country && <div>{customer.country}</div>}
              {customer?.vatNumber && (
                <div className="text-ink-soft">VAT: {customer.vatNumber}</div>
              )}
            </div>
          </div>

          <table className="mt-8 w-full">
            <thead>
              <tr className="border-b-2 border-ink/15">
                <th className="th pl-0">Description</th>
                <th className="th text-right">Qty</th>
                <th className="th text-right">Unit price</th>
                <th className="th text-right">VAT</th>
                <th className="th pr-0 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {inv.lines.map((l) => (
                <tr key={l.id}>
                  <td className="td pl-0">
                    <span className="whitespace-pre-wrap">{l.description}</span>
                  </td>
                  <td className="td text-right tabular">{l.quantity}</td>
                  <td className="td text-right tabular">{money(l.unitPrice)}</td>
                  <td className="td text-right tabular text-ink-soft">
                    {l.vatRate ? pct(l.vatRate) : "—"}
                  </td>
                  <td className="td pr-0 text-right tabular font-medium">
                    {money(l.lineNet)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-6 flex justify-end">
            <div className="w-72 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-faint">Subtotal</span>
                <span className="tabular">{money(inv.subtotal)}</span>
              </div>
              {[...breakdown.values()]
                .filter((b) => b.vat > 0)
                .map((b) => (
                  <div key={b.label} className="flex justify-between">
                    <span className="text-ink-faint">VAT — {b.label}</span>
                    <span className="tabular">{money(b.vat)}</span>
                  </div>
                ))}
              <div className="flex justify-between border-t-2 border-ink/15 pt-2 text-base font-bold">
                <span>Total</span>
                <span className="tabular text-brand">{money(inv.total)}</span>
              </div>
              {inv.amountPaid > 0 && (
                <>
                  <div className="flex justify-between text-money-in">
                    <span>Paid</span>
                    <span className="tabular">−{money(inv.amountPaid)}</span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span>Balance due</span>
                    <span className="tabular">{money(due)}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {(inv.notes || settings?.iban) && (
            <div className="mt-8 border-t border-line pt-4 text-sm text-ink-soft">
              {inv.notes && <p className="whitespace-pre-wrap">{inv.notes}</p>}
              {(settings?.iban || settings?.bic) && (
                <div className="mt-3">
                  <span className="font-medium text-ink">Payment details:</span>{" "}
                  {settings?.iban && <span className="tabular">IBAN {settings.iban}</span>}
                  {settings?.bic && <span className="tabular"> · BIC {settings.bic}</span>}
                </div>
              )}
            </div>
          )}
          {inv.terms && (
            <p className="mt-2 text-xs text-ink-faint whitespace-pre-wrap">
              {inv.terms}
            </p>
          )}
          {settings?.invoiceFooter && (
            <p className="mt-6 text-center text-xs text-ink-faint">
              {settings.invoiceFooter}
            </p>
          )}
        </Card>

        <InvoiceActions
          invoiceId={inv.id}
          total={inv.total}
          amountPaid={inv.amountPaid}
          status={inv.status}
          payments={inv.payments}
        />
      </div>
    </div>
  );
}
