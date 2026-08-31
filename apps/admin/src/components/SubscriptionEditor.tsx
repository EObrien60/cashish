import { SUBSCRIPTION_STATUSES } from "@cashish/core/plans";
import { saveSubscription } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";

export function SubscriptionEditor({
  tenantId,
  subscription,
  plans,
}: {
  tenantId: string;
  subscription:
    | { planCode: string; status: string; trialEndsAt: string | null; currentPeriodEnd: string | null; note: string }
    | null;
  plans: { code: string; name: string }[];
}) {
  return (
    <ActionForm action={saveSubscription} className="space-y-3">
      <input type="hidden" name="tenantId" value={tenantId} />

      {!subscription && (
        <p className="text-xs text-warn bg-warn/10 rounded-md px-2 py-1.5">
          This business has no subscription. Saving creates one.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="adm-label" htmlFor="planCode">Plan</label>
          <select id="planCode" name="planCode" defaultValue={subscription?.planCode ?? "company"} className="adm-input">
            {plans.map((plan) => (
              <option key={plan.code} value={plan.code}>{plan.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="adm-label" htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={subscription?.status ?? "trialing"} className="adm-input">
            {SUBSCRIPTION_STATUSES.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="adm-label" htmlFor="trialEndsAt">Trial ends</label>
          <input id="trialEndsAt" name="trialEndsAt" type="date" defaultValue={subscription?.trialEndsAt?.slice(0, 10) ?? ""} className="adm-input" />
        </div>
        <div>
          <label className="adm-label" htmlFor="currentPeriodEnd">Period ends</label>
          <input id="currentPeriodEnd" name="currentPeriodEnd" type="date" defaultValue={subscription?.currentPeriodEnd?.slice(0, 10) ?? ""} className="adm-input" />
        </div>
      </div>

      <div>
        <label className="adm-label" htmlFor="note">Note</label>
        <textarea id="note" name="note" rows={2} defaultValue={subscription?.note ?? ""} className="adm-input" placeholder="Why this is what it is — extended trial, migrating from Sage, and so on." />
      </div>

      <button className="adm-btn-primary">{subscription ? "Save subscription" : "Create subscription"}</button>
    </ActionForm>
  );
}
