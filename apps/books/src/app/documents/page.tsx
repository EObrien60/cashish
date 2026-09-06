import { withTenant } from "@/lib/request-context";
import { listDocuments } from "@/lib/documents";
import { aiIsConfigured } from "@/lib/ai";
import { PageHeader } from "@/components/ui";
import { DocumentsView } from "@/components/DocumentsView";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  return withTenant(async () => {
    const all = await listDocuments();
    // "Failed" belongs with the waiting ones: it still needs a decision, even
    // if that decision is to read it again or type it in by hand.
    const pending = all.filter((d) => d.status === "pending" || d.status === "failed");
    const done = all.filter((d) => d.status === "confirmed" || d.status === "rejected");

    return (
      <div>
        <PageHeader
          title="Documents"
          subtitle="Invoices, receipts and payslips, read into fields. Nothing reaches the books until you say so."
        />
        <DocumentsView pending={pending} done={done} aiAvailable={aiIsConfigured()} />
      </div>
    );
  });
}
