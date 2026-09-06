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
        title="Your books"
        subtitle="A business or a personal book. Each keeps its own categories, rules and people, and nothing is shared between them."
      />
      <BusinessesView
        businesses={memberships.map((m) => ({
          id: m.tenantId,
          slug: m.slug,
          name: m.name,
          role: m.role,
          kind: m.kind,
        }))}
        activeId={session.tenantId}
        createBusiness={createBusiness}
        switchTenant={switchTenant}
      />
    </div>
  );
}
