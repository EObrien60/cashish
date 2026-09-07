import { requireAdmin } from "@/lib/admin-session";
import { getPlatformSettings } from "@/queries/platform-settings";
import { PageHeader, Section } from "@/components/ui";
import { savePlatformSettings } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";

export const dynamic = "force-dynamic";

/**
 * The platform's own Stripe account (subscription billing for cashish itself)
 * and email provider (transactional email sent on every tenant's behalf).
 *
 * Not to be confused with a tenant's own Stripe key — that's per-tenant, in
 * their own Settings → Payments, and pays them directly for their invoices.
 */
export default async function PlatformSettingsPage() {
  await requireAdmin();
  const settings = await getPlatformSettings();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform settings"
        subtitle="cashish's own Stripe account and email sending — not a tenant's. A tenant's Stripe key lives in their own Settings → Payments."
      />

      <Section title="Stripe — platform subscription billing">
        <ActionForm action={savePlatformSettings} className="adm-card p-4 space-y-3 max-w-xl">
          <p className="text-xs text-ink-faint">
            Charges tenants for their cashish subscription. This is OBH&apos;s own Stripe
            account — separate from any tenant&apos;s own key.
          </p>
          <div>
            <label className="adm-label">Secret key</label>
            <input
              name="stripeSecretKey"
              type="password"
              autoComplete="off"
              defaultValue={settings.stripeSecretKey ?? ""}
              placeholder="sk_live_… or sk_test_…"
              className="adm-input adm-mono"
            />
          </div>
          <div>
            <label className="adm-label">Webhook signing secret</label>
            <input
              name="stripeWebhookSecret"
              type="password"
              autoComplete="off"
              defaultValue={settings.stripeWebhookSecret ?? ""}
              placeholder="whsec_…"
              className="adm-input adm-mono"
            />
          </div>
          <button className="adm-btn-primary" type="submit">
            Save
          </button>
        </ActionForm>
      </Section>

      <Section title="Email — sent on every tenant's behalf">
        <ActionForm action={savePlatformSettings} className="adm-card p-4 space-y-3 max-w-xl">
          <p className="text-xs text-ink-faint">
            One provider account for the whole platform. A tenant&apos;s business name is
            used as the display name; the sending domain and API key are cashish&apos;s own.
          </p>
          <div>
            <label className="adm-label">Provider</label>
            <select
              name="emailProvider"
              defaultValue={settings.emailProvider ?? "sendgrid"}
              className="adm-input"
            >
              <option value="sendgrid">SendGrid</option>
              <option value="resend">Resend</option>
            </select>
          </div>
          <div>
            <label className="adm-label">API key</label>
            <input
              name="emailApiKey"
              type="password"
              autoComplete="off"
              defaultValue={settings.emailApiKey ?? ""}
              placeholder="SG.… (SendGrid) or re_… (Resend)"
              className="adm-input adm-mono"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="adm-label">From address</label>
              <input
                name="emailFromAddress"
                defaultValue={settings.emailFromAddress ?? ""}
                placeholder="invoices@cashish.online"
                className="adm-input"
              />
            </div>
            <div>
              <label className="adm-label">Default from name</label>
              <input
                name="emailFromName"
                defaultValue={settings.emailFromName ?? "cashish"}
                className="adm-input"
              />
            </div>
          </div>
          <p className="text-xs text-ink-faint">
            The from address&apos;s domain must be verified in the email provider first, or
            sends will fail.
          </p>
          <button className="adm-btn-primary" type="submit">
            Save
          </button>
        </ActionForm>
      </Section>
    </div>
  );
}
