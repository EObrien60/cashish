import Link from "next/link";
import { boot } from "@/lib/boot";
import { db, schema } from "@/db/client";
import { desc } from "drizzle-orm";
import { listInvoices } from "@/lib/invoices";
import { money, fmtDate, round2 } from "@/lib/format";
import { Card, PageHeader, StatusBadge, EmptyState } from "@/components/ui";
import { IconPlus } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  boot();
  const invoices = listInvoices();
  const customers = new Map(
    db.select().from(schema.customers).all().map((c) => [c.id, c]),
  );

  const today = new Date().toISOString().slice(0, 10);
  const outstanding = round2(
    invoices
      .filter((i) => i.status !== "void" && i.status !== "draft")
      .reduce((s, i) => s + (i.total - i.amountPaid), 0),
  );

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle={`${money(outstanding)} outstanding`}
        actions={
          <Link href="/invoices/new" className="btn-primary">
            <IconPlus className="h-4 w-4" /> New invoice
          </Link>
        }
      />

      <Card className="overflow-hidden">
        {invoices.length === 0 ? (
          <EmptyState
            title="No invoices yet"
            hint="Create your first invoice. Pull lines straight from your product library."
            action={
              <Link href="/invoices/new" className="btn-primary">
                <IconPlus className="h-4 w-4" /> New invoice
              </Link>
            }
          />
        ) : (
          <table className="w-full">
            <thead className="border-b border-line bg-paper/60">
              <tr>
                <th className="th">Number</th>
                <th className="th">Customer</th>
                <th className="th">Issued</th>
                <th className="th">Due</th>
                <th className="th">Status</th>
                <th className="th text-right">Total</th>
                <th className="th text-right">Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {invoices.map((inv) => {
                const due = round2(inv.total - inv.amountPaid);
                const overdue =
                  inv.dueDate &&
                  inv.dueDate < today &&
                  due > 0.005 &&
                  inv.status !== "void" &&
                  inv.status !== "draft";
                return (
                  <tr key={inv.id} className="hover:bg-paper/50">
                    <td className="td">
                      <Link
                        href={`/invoices/${inv.id}`}
                        className="font-semibold text-brand hover:underline"
                      >
                        {inv.number}
                      </Link>
                    </td>
                    <td className="td">
                      {customers.get(inv.customerId)?.name ?? "—"}
                    </td>
                    <td className="td text-ink-soft tabular">
                      {fmtDate(inv.issueDate)}
                    </td>
                    <td className="td tabular">
                      <span className={overdue ? "text-money-out font-medium" : "text-ink-soft"}>
                        {fmtDate(inv.dueDate)}
                      </span>
                    </td>
                    <td className="td">
                      <StatusBadge status={overdue ? "overdue" : inv.status} />
                    </td>
                    <td className="td text-right tabular font-medium">
                      {money(inv.total)}
                    </td>
                    <td className="td text-right tabular">
                      {due > 0.005 ? money(due) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
