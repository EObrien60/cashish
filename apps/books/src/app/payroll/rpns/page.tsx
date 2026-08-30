import Link from "next/link";
import { withTenant } from "@/lib/request-context";
import { listRpns } from "@/lib/lookups";
import { listEmployees } from "@/lib/payroll";
import { PageHeader } from "@/components/ui";
import { RpnImportView } from "@/components/RpnImportView";

export const dynamic = "force-dynamic";

export default async function RpnsPage() {
  return withTenant(async () => {
    const taxYear = new Date().getFullYear();
    const employees = await listEmployees();
    const rpns = await listRpns(taxYear);

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
  });
}
