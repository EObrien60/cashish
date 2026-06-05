import { boot } from "@/lib/boot";
import { db, schema } from "@/db/client";
import { PageHeader } from "@/components/ui";
import { CustomersView } from "@/components/CustomersView";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  boot();
  const customers = db
    .select()
    .from(schema.customers)
    .orderBy(schema.customers.name)
    .all();
  return (
    <div>
      <PageHeader title="Customers" subtitle="People and businesses you invoice." />
      <CustomersView customers={customers} />
    </div>
  );
}
