import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@/lib/request-context";
import { getProductDetail } from "@/lib/detail";
import { money, pct, fmtDate } from "@/lib/format";
import { Card, PageHeader, StatCard, StatusBadge, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return withTenant(async () => {
    const detail = await getProductDetail(id);
    if (!detail) notFound();
    const { product, vat, category, lines, totals, priceHistory, priceVaried, byCustomer } = detail;

    return (
      <div>
        <PageHeader
          title={product.name}
          subtitle={
            [
              product.kind === "good" ? "Product" : "Service",
              product.sku && `SKU ${product.sku}`,
              vat && `${vat.name}`,
              category && `income → ${category.name}`,
              product.archived && "archived",
            ]
              .filter(Boolean)
              .join(" · ")
          }
          actions={
            <Link href="/products" className="btn-outline">
              All products
            </Link>
          }
        />

        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Current price" value={money(product.unitPrice)} sub="net, excl. VAT" />
          <StatCard label="Units sold" value={String(totals.unitsSold)} sub={`${totals.invoiceCount} invoice(s)`} />
          <StatCard label="Net invoiced" value={money(totals.net)} tone="in" />
          <StatCard
            label="Average price"
            value={money(totals.averagePrice)}
            sub={priceVaried ? "price has varied" : "consistent"}
            tone={priceVaried ? "out" : "default"}
          />
        </div>

        {product.description && (
          <Card className="mb-6 p-4 text-sm text-ink-soft">{product.description}</Card>
        )}

        {priceVaried && (
          <>
            <h2 className="mb-2 text-sm font-semibold">Price history</h2>
            <Card className="mb-6 p-4">
              <div className="flex flex-wrap gap-2 text-xs">
                {priceHistory.map((p, i) => {
                  const prev = i > 0 ? priceHistory[i - 1].unitPrice : null;
                  const changed = prev !== null && prev !== p.unitPrice;
                  return (
                    <span
                      key={`${p.number}-${i}`}
                      className={`rounded-lg border px-2 py-1 ${
                        changed ? "border-money-out text-money-out" : "border-line text-ink-soft"
                      }`}
                    >
                      {fmtDate(p.date)} · {money(p.unitPrice)}
                      <span className="ml-1 text-ink-faint">#{p.number}</span>
                    </span>
                  );
                })}
              </div>
            </Card>
          </>
        )}

        <h2 className="mb-2 text-sm font-semibold">Appears on these invoices</h2>
        <Card className="mb-6 overflow-hidden">
          {lines.length === 0 ? (
            <EmptyState
              title="Not invoiced yet"
              hint="Add it to an invoice and the history appears here."
            />
          ) : (
            <table className="w-full">
              <thead className="border-b border-line bg-paper/60">
                <tr>
                  <th className="th">Invoice</th>
                  <th className="th">Issued</th>
                  <th className="th">Customer</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Qty</th>
                  <th className="th text-right">Unit price</th>
                  <th className="th text-right">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lines.map((l) => (
                  <tr key={l.lineId} className="hover:bg-paper/50">
                    <td className="td font-medium">
                      <Link href={`/invoices/${l.invoiceId}`} className="text-brand hover:underline">
                        {l.number}
                      </Link>
                    </td>
                    <td className="td text-ink-soft">{fmtDate(l.issueDate)}</td>
                    <td className="td">
                      <Link href={`/customers/${l.customerId}`} className="text-brand hover:underline">
                        {l.customerName}
                      </Link>
                    </td>
                    <td className="td">
                      <StatusBadge status={l.status} />
                    </td>
                    <td className="td tabular text-right">{l.quantity}</td>
                    <td className="td tabular text-right">
                      {money(l.unitPrice)}
                      {l.unitPrice !== product.unitPrice && (
                        <span className="ml-1 text-xs text-money-out">≠</span>
                      )}
                    </td>
                    <td className="td tabular text-right">{money(l.lineNet)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {byCustomer.length > 0 && (
          <>
            <h2 className="mb-2 text-sm font-semibold">Who buys it</h2>
            <Card className="overflow-hidden">
              <table className="w-full">
                <thead className="border-b border-line bg-paper/60">
                  <tr>
                    <th className="th">Customer</th>
                    <th className="th text-right">Qty</th>
                    <th className="th text-right">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {byCustomer.map((c) => (
                    <tr key={c.id} className="hover:bg-paper/50">
                      <td className="td">
                        <Link href={`/customers/${c.id}`} className="text-brand hover:underline">
                          {c.name}
                        </Link>
                      </td>
                      <td className="td tabular text-right">{c.quantity}</td>
                      <td className="td tabular text-right">{money(c.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </div>
    );
  });
}
