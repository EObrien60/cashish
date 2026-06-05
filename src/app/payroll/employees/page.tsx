import Link from "next/link";
import { boot } from "@/lib/boot";
import { listEmployees } from "@/lib/payroll";
import { PageHeader } from "@/components/ui";
import { EmployeesView } from "@/components/EmployeesView";

export const dynamic = "force-dynamic";

export default async function EmployeesPage() {
  boot();
  const employees = listEmployees();
  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle="People on your payroll — employees and directors."
        actions={
          <Link href="/payroll" className="btn-ghost">
            ← Payroll
          </Link>
        }
      />
      <EmployeesView employees={employees} />
    </div>
  );
}
