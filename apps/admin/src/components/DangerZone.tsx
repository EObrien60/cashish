import { deleteTenant, setTenantSuspended } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";

/**
 * Suspension is reversible and touches no data; deletion is neither, so it asks
 * for the slug to be typed. The two sit together because they are the only
 * actions on this page that a mis-click should not be able to perform.
 */
export function DangerZone({
  tenantId,
  slug,
  suspended,
  hasSubscription,
}: {
  tenantId: string;
  slug: string;
  suspended: boolean;
  hasSubscription: boolean;
}) {
  return (
    <section className="border border-danger/30 bg-danger/[0.03] rounded-lg overflow-hidden mt-8">
      <div className="px-3 py-2 border-b border-danger/20">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-danger">Danger zone</h2>
      </div>

      <div className="p-3 flex items-start justify-between gap-6 border-b border-danger/15">
        <div>
          <div className="text-sm font-medium">{suspended ? "Suspended" : "Suspend this business"}</div>
          <p className="text-xs text-ink-faint mt-0.5">
            Sets the subscription to suspended. Nothing is deleted and it can be undone.
          </p>
        </div>
        <ActionForm action={setTenantSuspended}>
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="suspended" value={suspended ? "false" : "true"} />
          <button className="adm-btn-ghost text-sm" disabled={!hasSubscription}>
            {suspended ? "Lift suspension" : "Suspend"}
          </button>
        </ActionForm>
      </div>

      <ActionForm action={deleteTenant} className="p-3 flex items-end justify-between gap-6">
        <div className="flex-1">
          <div className="text-sm font-medium">Delete this business and everything in it</div>
          <p className="text-xs text-ink-faint mt-0.5 mb-2">
            Transactions, invoices, receipts, payroll and members, permanently. The audit entry
            keeps a record of what was here.
          </p>
          <input type="hidden" name="tenantId" value={tenantId} />
          <input
            name="confirm"
            className="adm-input max-w-xs"
            placeholder={`Type ${slug} to confirm`}
            autoComplete="off"
          />
        </div>
        <button className="adm-btn-danger text-sm">Delete</button>
      </ActionForm>
    </section>
  );
}
