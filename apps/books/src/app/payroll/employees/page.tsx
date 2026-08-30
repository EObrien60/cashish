import Link from "next/link";
import { withTenant } from "@/lib/request-context";
import { listPeople, paidByEmployee } from "@/lib/people";
import { PageHeader } from "@/components/ui";
import { EmployeesView } from "@/components/EmployeesView";
import { PeopleQuickAdd } from "@/components/PeopleQuickAdd";
import { createPersonAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function EmployeesPage() {
  return withTenant(async () => {
    const [employees, paid] = await Promise.all([
      listPeople({ includeLeavers: true }),
      paidByEmployee(),
    ]);
    return (
      <div>
        <PageHeader
          title="People"
          subtitle="Anyone you pay. A name is enough — payroll filing needs more, but recording who money went to does not."
          actions={
            <Link href="/payroll" className="btn-ghost">
              ← Payroll
            </Link>
          }
        />
        <PeopleQuickAdd action={createPersonAction} />
        <EmployeesView employees={employees} paid={Object.fromEntries(paid)} />
      </div>
    );
  });
}
