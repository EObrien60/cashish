import Link from "next/link";
import { boot } from "@/lib/boot";
import { db, schema } from "@/db/client";
import { eq, desc } from "drizzle-orm";
import { listEmployees } from "@/lib/payroll";
import { PageHeader } from "@/components/ui";
import { RpnImportView } from "@/components/RpnImportView";

export const dynamic = "force-dynamic";

export default async function RpnsPage() {
  boot();
  const taxYear = new Date().getFullYear();
  const employees = listEmployees();
  const rpns = db
    .select()
    .from(schema.rpns)
    .where(eq(schema.rpns.taxYear, taxYear))
    .orderBy(desc(schema.rpns.createdAt))
    .all();

  return (
    <div>
      <PageHeader
        title="RPNs"
        subtitle="Revenue Payroll Notifications — your employees' tax instructions."
        actions={<Link href="/payroll" className="btn-ghost">← Payroll</Link>}
      />
      <RpnImportView rpns={rpns} employees={employees} taxYear={taxYear} />
    </div>
  );
}
