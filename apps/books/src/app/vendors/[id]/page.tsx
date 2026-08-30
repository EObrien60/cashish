import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@/lib/request-context";
import { getVendorDetail } from "@/lib/vendors";
import { listCategories, listVatRates } from "@/lib/lookups";
import { money, fmtDate } from "@/lib/format";
import { Card, PageHeader, StatCard } from "@/components/ui";
import { VendorDetailView } from "@/components/VendorDetailView";
import {
  createBillAction,
  postBillToTransactionAction,
  setBillStatusAction,
  deleteBillAction,
  setTxVendorAction,
} from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function VendorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return withTenant(async () => {
    const detail = await getVendorDetail(id);
    if (!detail) notFound();
    const [categories, vatRates] = await Promise.all([listCategories(), listVatRates()]);
    const { vendor, totals } = detail;

    return (
      <div>
        <PageHeader
          title={vendor.name}
          subtitle={
            [
              vendor.archived ? "Archived" : "Vendor",
              vendor.email,
              vendor.vatNumber && `VAT ${vendor.vatNumber}`,
              [vendor.city, vendor.country].filter(Boolean).join(", "),
            ]
              .filter(Boolean)
              .join(" · ")
          }
          actions={
            <Link href="/vendors" className="btn-outline">
              All vendors
            </Link>
          }
        />

        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Lifetime spend"
            value={money(totals.lifetimeSpend)}
            tone="out"
            sub={`${totals.txCount} payment(s)${
              totals.firstPaid ? ` since ${fmtDate(totals.firstPaid)}` : ""
            }`}
          />
          <StatCard
            label="Billed"
            value={money(totals.billed)}
            sub={`${totals.billCount} bill(s) on file`}
          />
          <StatCard
            label="Still owed"
            value={money(totals.billsOutstanding)}
            tone={totals.billsOutstanding > 0.005 ? "out" : "default"}
            sub={totals.billsOutstanding > 0.005 ? "awaiting payment" : "nothing outstanding"}
          />
          <StatCard
            label={totals.refundCount > 0 ? "Refunded to you" : "VAT on bills"}
            value={money(totals.refundCount > 0 ? totals.refunded : totals.vatReclaimable)}
            tone={totals.refundCount > 0 ? "in" : "default"}
            sub={
              totals.refundCount > 0
                ? `${totals.refundCount} credit(s)`
                : "as recorded on the documents"
            }
          />
        </div>

        {vendor.notes && (
          <Card className="mb-6 p-4 text-sm text-ink-soft">{vendor.notes}</Card>
        )}

        <VendorDetailView
          vendor={{ id: vendor.id, name: vendor.name }}
          bills={detail.bills.map((b) => ({
            id: b.id,
            number: b.number,
            issueDate: b.issueDate,
            dueDate: b.dueDate,
            status: b.status,
            net: b.net,
            vatTotal: b.vatTotal,
            total: b.total,
            amountPaid: b.amountPaid,
            outstanding: b.outstanding,
            overdue: b.overdue,
            categoryName: b.categoryName,
            fileName: b.fileName ?? "",
            notes: b.notes ?? "",
          }))}
          transactions={detail.transactions.map((t) => ({
            id: t.id,
            date: t.bookedDate,
            amount: t.amount,
            description: t.description ?? "",
            reference: t.reference ?? "",
            excluded: t.excluded,
            billLinked: t.billLinked,
          }))}
          byYear={detail.byYear}
          categories={categories
            .filter((c) => c.kind === "expense")
            .map((c) => ({ id: c.id, name: c.name }))}
          vatRates={vatRates.map((v) => ({ id: v.id, name: v.name, rate: v.rate }))}
          defaultCategoryId={vendor.defaultCategoryId}
          createBill={createBillAction}
          postBill={postBillToTransactionAction}
          setBillStatus={setBillStatusAction}
          deleteBill={deleteBillAction}
          setTxVendor={setTxVendorAction}
        />
      </div>
    );
  });
}
