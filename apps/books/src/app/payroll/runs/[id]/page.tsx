import { withTenant } from "@/lib/request-context";
import { getPayRun } from "@/lib/payroll";
import { PayRunBuilder } from "@/components/PayRunBuilder";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PayRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return withTenant(async () => {
    const { id } = await params;
    const run = await getPayRun(id);
    if (!run) notFound();
    return <PayRunBuilder run={run} />;
  });
}
