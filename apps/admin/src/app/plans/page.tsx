import { requireAdmin } from "@/lib/admin-session";
import { listPlansWithCounts } from "@/queries/subscriptions";
import { FEATURE_KEYS } from "@cashish/core/plans";
import { PageHeader } from "@/components/ui";
import { savePlan } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";

export const dynamic = "force-dynamic";

/**
 * Plan definitions are editable here rather than in code, which is the whole
 * argument for keeping them in a table: raising a limit or changing a price is
 * an operational decision, and it should not need a deploy.
 */
export default async function PlansPage() {
  await requireAdmin();
  const plans = await listPlansWithCounts();

  return (
    <div>
      <PageHeader
        title="Plans"
        subtitle="What each plan entitles one set of books to. The pricing page reads these numbers, so it cannot advertise a limit that is not enforced."
      />

      <div className="grid grid-cols-3 gap-4">
        {plans.map((plan) => (
          <ActionForm key={plan.code} action={savePlan} className="adm-card p-4 space-y-3">
            <input type="hidden" name="code" value={plan.code} />

            <div className="flex items-baseline justify-between">
              <span className="adm-mono">{plan.code}</span>
              <span className="text-xs text-ink-faint">
                {plan.subscriberCount} {plan.subscriberCount === 1 ? "business" : "businesses"}
              </span>
            </div>

            <div>
              <label className="adm-label">Name</label>
              <input name="name" defaultValue={plan.name} className="adm-input" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="adm-label">Price (cents)</label>
                <input
                  name="priceCents"
                  defaultValue={plan.priceCents ?? ""}
                  placeholder="blank = talk to us"
                  className="adm-input tnum"
                  inputMode="numeric"
                />
              </div>
              <div>
                <label className="adm-label">Max users</label>
                <input
                  name="maxUsers"
                  defaultValue={plan.maxUsers ?? ""}
                  placeholder="blank = unlimited"
                  className="adm-input tnum"
                  inputMode="numeric"
                />
              </div>
            </div>

            <fieldset>
              <legend className="adm-label">Features</legend>
              <div className="grid grid-cols-2 gap-1">
                {FEATURE_KEYS.map((key) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name={`feature.${key}`}
                      defaultChecked={plan.features[key]}
                      className="accent-accent"
                    />
                    {key}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="isActive"
                value="true"
                defaultChecked={plan.isActive}
                className="accent-accent"
              />
              Offered to new customers
            </label>

            <button className="adm-btn-primary w-full">Save {plan.name}</button>
          </ActionForm>
        ))}
      </div>
    </div>
  );
}
