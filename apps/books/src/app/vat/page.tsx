import Link from "next/link";
import { withTenant } from "@/lib/request-context";
import { computeVatReturn } from "@/lib/vat";
import { vatPeriods } from "@/lib/period";
import { money, fmtDate } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

function currentVatPeriodKey(): { year: number; p: string } {
  const d = new Date();
  const year = d.getFullYear();
  const idx = Math.floor(d.getMonth() / 2) + 1;
  return { year, p: `${year}-p${idx}` };
}

export default async function VatPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; p?: string }>;
}) {
  return withTenant(async () => {
    const sp = await searchParams;
    const cur = currentVatPeriodKey();
    const year = Number(sp.year) || cur.year;
    const list = vatPeriods(year);
    const selectedKey = sp.p ?? cur.p;
    const period = list.find((x) => x.key === selectedKey) ?? list[0];

    const vat = await computeVatReturn(period.from, period.to);

    const box = (label: string, code: string, value: number, tone?: string) => (
      <div className="flex items-center justify-between border-b border-line py-3 last:border-0">
        <div>
          <span className="inline-block w-8 font-mono text-xs font-bold text-ink-faint">
            {code}
          </span>
          <span className="text-sm">{label}</span>
        </div>
        <span className={`tabular text-lg font-semibold ${tone ?? ""}`}>
          {money(value)}
        </span>
      </div>
    );

    return (
      <div>
        <PageHeader
          title="VAT return"
          subtitle="Irish VAT3 — cash receipts basis. Figures for the selected period."
        />

        {/* Period selector */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1 rounded-lg border border-line bg-card p-1">
            <Link
              href={`/vat?year=${year - 1}`}
              className="rounded-md px-2 py-1 text-sm text-ink-soft hover:bg-black/5"
            >
              ←
            </Link>
            <span className="px-2 text-sm font-semibold tabular">{year}</span>
            <Link
              href={`/vat?year=${year + 1}`}
              className="rounded-md px-2 py-1 text-sm text-ink-soft hover:bg-black/5"
            >
              →
            </Link>
          </div>
          <div className="inline-flex flex-wrap gap-1 rounded-lg border border-line bg-card p-1 text-sm">
            {list.map((p) => (
              <Link
                key={p.key}
                href={`/vat?year=${year}&p=${p.key}`}
                className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                  period.key === p.key
                    ? "bg-brand text-white"
                    : "text-ink-soft hover:bg-black/5"
                }`}
              >
                {p.label.replace(` ${year}`, "")}
              </Link>
            ))}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="p-6 lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">VAT3 figures</h2>
              <span className="text-xs text-ink-faint">
                {fmtDate(period.from)} – {fmtDate(period.to)}
              </span>
            </div>

            {box("VAT on sales (cash received)", "T1", vat.t1_salesVat)}
            {box("VAT on purchases", "T2", vat.t2_purchasesVat)}
            {vat.t3_payable > 0
              ? box("Net payable to Revenue", "T3", vat.t3_payable, "text-money-out")
              : box("Net repayable by Revenue", "T4", vat.t4_repayable, "text-money-in")}

            <div className="mt-6 rounded-lg bg-paper px-4 py-3 text-sm text-ink-soft">
              {vat.t3_payable > 0 ? (
                <>
                  You owe Revenue{" "}
                  <strong className="text-ink">{money(vat.t3_payable)}</strong> for
                  this period.
                </>
              ) : vat.t4_repayable > 0 ? (
                <>
                  Revenue owes you{" "}
                  <strong className="text-ink">{money(vat.t4_repayable)}</strong>{" "}
                  for this period.
                </>
              ) : (
                <>Nothing due either way this period.</>
              )}
            </div>

            {vat.unassignedExpenseCount > 0 && (
              <div className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {vat.unassignedExpenseCount} expense transaction
                {vat.unassignedExpenseCount === 1 ? "" : "s"} in this period have no
                category or VAT rate — you may be missing input VAT. Review them on{" "}
                <Link href="/transactions?filter=uncategorized" className="font-medium underline">
                  Transactions
                </Link>
                .
              </div>
            )}
          </Card>

          <div className="space-y-4">
            <Card className="p-5">
              <h3 className="mb-3 text-sm font-semibold">Sales detail</h3>
              <div className="space-y-1 text-sm">
                <Row label="Net sales (ex-VAT)" value={money(vat.netSales)} />
                <Row label="VAT charged" value={money(vat.t1_salesVat)} />
              </div>
            </Card>
            <Card className="p-5">
              <h3 className="mb-3 text-sm font-semibold">Purchases detail</h3>
              {vat.purchasesByRate.length === 0 ? (
                <p className="text-sm text-ink-faint">
                  No VAT-rated purchases tagged in this period.
                </p>
              ) : (
                <div className="space-y-2 text-sm">
                  {vat.purchasesByRate.map((r) => (
                    <div key={r.rateId} className="flex justify-between">
                      <span className="text-ink-soft">{r.name}</span>
                      <span className="tabular">{money(r.vat)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-line pt-2 font-medium">
                    <span>Net purchases</span>
                    <span className="tabular">{money(vat.netPurchases)}</span>
                  </div>
                </div>
              )}
            </Card>
          </div>
        </div>

        <p className="mt-4 max-w-2xl text-xs text-ink-faint">
          cashish computes VAT on the cash receipts basis: output VAT (T1) is
          recognised when customers pay invoices, and input VAT (T2) is taken from
          bank transactions you've tagged with a VAT rate. Always reconcile against
          your records before filing — this is a working figure, not tax advice.
        </p>
      </div>
    );
  });
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-ink-soft">{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}
