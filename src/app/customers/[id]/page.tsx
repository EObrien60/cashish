import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@/lib/request-context";
import { getCustomerDetail } from "@/lib/detail";
import { money, fmtDate } from "@/lib/format";
import { Card, PageHeader, StatCard, StatusBadge, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return withTenant(async () => {
    const detail = await getCustomerDetail(id);
    if (!detail) notFound();
    const { customer, invoices, payments, totals, bought } = detail;

    const address = [
      customer.addressLine1,
      customer.addressLine2,
      customer.city,
      customer.country,
    ]
      .filter(Boolean)
      .join(", ");

    return (
      <div>
        <PageHeader
          title={customer.name}
          subtitle={
            customer.archived
              ? "Archived customer"
              : [customer.email, customer.vatNumber && `VAT ${customer.vatNumber}`]
                  .filter(Boolean)
                  .join(" · ") || "Customer"
          }
          actions={
            <Link href="/customers" className="btn-outline">
              All customers
            </Link>
          }
        />

        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Invoiced" value={money(totals.invoiced)} sub={`${totals.invoiceCount} invoice(s)`} />
          <StatCard label="Received" value={money(totals.received)} tone="in" />
          <StatCard
            label="Outstanding"
            value={money(totals.outstanding)}
            tone={totals.outstanding > 0 ? "out" : "default"}
            sub={totals.openCount ? `${totals.openCount} open` : "all settled"}
          />
          <StatCard
            label="Overdue"
            value={money(totals.overdue)}
            tone={totals.overdue > 0 ? "out" : "default"}
            sub={totals.worstDaysOverdue ? `worst ${totals.worstDaysOverdue} days` : "nothing overdue"}
          />
        </div>

        {(address || customer.notes) && (
          <Card className="mb-6 p-4 text-sm">
            {address && <div className="text-ink-soft">{address}</div>}
            {customer.notes && <div className="mt-2 text-ink-faint">{customer.notes}</div>}
          </Card>
        )}

        <h2 className="mb-2 text-sm font-semibold">Invoices</h2>
        <Card className="mb-6 overflow-hidden">
          {invoices.length === 0 ? (
            <EmptyState title="No invoices yet" hint="Raise one from the Invoices screen." />
          ) : (
            <table className="w-full">
              <thead className="border-b border-line bg-paper/60">
                <tr>
                  <th className="th">Number</th>
                  <th className="th">Issued</th>
                  <th className="th">Due</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Total</th>
                  <th className="th text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-paper/50">
                    <td className="td font-medium">
                      <Link href={`/invoices/${inv.id}`} className="text-brand hover:underline">
                        {inv.number}
                      </Link>
                    </td>
                    <td className="td text-ink-soft">{fmtDate(inv.issueDate)}</td>
                    <td className="td text-ink-soft">{inv.dueDate ? fmtDate(inv.dueDate) : "—"}</td>
                    <td className="td">
                      <StatusBadge status={inv.status} />
                    </td>
                    <td className="td tabular text-right">{money(inv.total)}</td>
                    <td className="td tabular text-right">
                      {inv.outstanding > 0.005 ? money(inv.outstanding) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h2 className="mb-2 text-sm font-semibold">Payments received</h2>
            <Card className="overflow-hidden">
              {payments.length === 0 ? (
                <EmptyState title="Nothing received yet" hint="Match a bank inflow to an invoice." />
              ) : (
                <table className="w-full">
                  <thead className="border-b border-line bg-paper/60">
                    <tr>
                      <th className="th">Date</th>
                      <th className="th">Invoice</th>
                      <th className="th">Method</th>
                      <th className="th text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {payments.map((p) => (
                      <tr key={p.id} className="hover:bg-paper/50">
                        <td className="td text-ink-soft">{fmtDate(p.date)}</td>
                        <td className="td">
                          <Link href={`/invoices/${p.invoiceId}`} className="text-brand hover:underline">
                            {p.invoiceNumber}
                          </Link>
                        </td>
                        <td className="td text-ink-faint">
                          {p.method ?? "bank"}
                          {p.transactionId ? " · linked" : ""}
                        </td>
                        <td className="td tabular text-right">{money(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold">What they buy</h2>
            <Card className="overflow-hidden">
              {bought.length === 0 ? (
                <EmptyState title="Nothing invoiced yet" hint="Invoice lines appear here." />
              ) : (
                <table className="w-full">
                  <thead className="border-b border-line bg-paper/60">
                    <tr>
                      <th className="th">Item</th>
                      <th className="th text-right">Qty</th>
                      <th className="th text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {bought.slice(0, 20).map((b, i) => (
                      <tr key={`${b.productId ?? "x"}-${i}`} className="hover:bg-paper/50">
                        <td className="td">
                          {b.productId ? (
                            <Link href={`/products/${b.productId}`} className="text-brand hover:underline">
                              {b.description}
                            </Link>
                          ) : (
                            <span>{b.description}</span>
                          )}
                        </td>
                        <td className="td tabular text-right">{b.quantity}</td>
                        <td className="td tabular text-right">{money(b.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </div>
      </div>
    );
  });
}
