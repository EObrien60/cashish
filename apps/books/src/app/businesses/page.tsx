import { redirect } from "next/navigation";
import { currentSession } from "@/lib/session";
import { membershipsFor } from "@/lib/auth";
import { createBusiness, switchTenant } from "../auth-actions";
import { PageHeader } from "@/components/ui";
import { BusinessesView } from "@/components/BusinessesView";

export const dynamic = "force-dynamic";

export default async function BusinessesPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  const memberships = await membershipsFor(session.userId);

  return (
    <div>
      <PageHeader
        title="Businesses"
        subtitle="Each keeps its own books, invoice numbering, categories, VAT rates and people. Nothing is shared between them."
      />
      <BusinessesView
        businesses={memberships.map((m) => ({
          id: m.tenantId,
          slug: m.slug,
          name: m.name,
          role: m.role,
        }))}
        activeId={session.tenantId}
        createBusiness={createBusiness}
        switchTenant={switchTenant}
      />
    </div>
  );
}
