import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-session";
import { getTenant, listPlans } from "@/queries/tenants";
import { auditForSubject } from "@/lib/audit";
import { PageHeader, Section, RolePill, Empty, Back, when } from "@/components/ui";
import { MemberRow } from "@/components/MemberRow";
import { SubscriptionEditor } from "@/components/SubscriptionEditor";
import { DangerZone } from "@/components/DangerZone";
import { revokeApiKey, revokeOauthTokens } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";

export const dynamic = "force-dynamic";

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const detail = await getTenant(id);
  if (!detail) notFound();

  const plans = await listPlans();
  const history = await auditForSubject("tenant", id, 20);
  const clients = [...new Set(detail.tokens.filter((t) => !t.revokedAt).map((t) => t.clientId))];

  return (
    <div>
      <div className="mb-3">
        <Back href="/tenants">← All tenants</Back>
      </div>
      <PageHeader
        title={detail.tenant.name}
        subtitle={`${detail.tenant.slug} · created ${when(detail.tenant.createdAt)}`}
      />

      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          ["Members", detail.counts.members],
          ["Transactions", detail.counts.transactions],
          ["Invoices", detail.counts.invoices],
          ["Customers", detail.counts.customers],
        ].map(([label, value]) => (
          <div key={label as string} className="adm-card p-3">
            <div className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</div>
            <div className="text-2xl font-semibold tnum mt-1">{value as number}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6 items-start">
        <div>
          <Section title="Subscription">
            <div className="p-3">
              <SubscriptionEditor
                tenantId={id}
                subscription={detail.subscription}
                plans={plans.map((p) => ({ code: p.code, name: p.name }))}
              />
            </div>
          </Section>

          <Section title="Business settings">
            {detail.settings ? (
              <dl className="p-3 text-sm grid grid-cols-2 gap-y-2">
                <dt className="text-ink-faint">Name on invoices</dt>
                <dd>{detail.settings.businessName}</dd>
                <dt className="text-ink-faint">VAT number</dt>
                <dd>{detail.settings.vatNumber || "—"}</dd>
                <dt className="text-ink-faint">VAT basis</dt>
                <dd>{detail.settings.vatBasis}</dd>
                <dt className="text-ink-faint">Invoice prefix</dt>
                <dd className="adm-mono">{detail.settings.invoicePrefix || "—"}</dd>
              </dl>
            ) : (
              <Empty>No settings row.</Empty>
            )}
          </Section>
        </div>

        <div>
          <Section title="Members">
            {detail.members.length ? (
              <table className="w-full">
                <tbody>
                  {detail.members.map((member) => (
                    <MemberRow key={member.userId} tenantId={id} member={member} />
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>Nobody has access to this business.</Empty>
            )}
          </Section>

          <Section title="API keys">
            {detail.keys.length ? (
              <table className="w-full">
                <tbody>
                  {detail.keys.map((key) => (
                    <tr key={key.id}>
                      <td className="adm-td">
                        <div className="font-medium">{key.name || "(unnamed)"}</div>
                        <div className="adm-mono">{key.prefix}…</div>
                      </td>
                      <td className="adm-td">
                        <RolePill role={key.role} />
                      </td>
                      <td className="adm-td text-ink-faint text-xs">
                        {key.revokedAt ? `revoked ${when(key.revokedAt)}` : `used ${when(key.lastUsedAt)}`}
                      </td>
                      <td className="adm-td text-right">
                        {!key.revokedAt && (
                          <ActionForm action={revokeApiKey}>
                            <input type="hidden" name="keyId" value={key.id} />
                            <input type="hidden" name="tenantId" value={id} />
                            <button className="text-xs text-danger hover:underline underline-offset-4">
                              Revoke
                            </button>
                          </ActionForm>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>No API keys.</Empty>
            )}
          </Section>

          <Section title="OAuth access">
            {clients.length ? (
              <table className="w-full">
                <tbody>
                  {clients.map((clientId) => (
                    <tr key={clientId}>
                      <td className="adm-td adm-mono">{clientId}</td>
                      <td className="adm-td text-right">
                        <ActionForm action={revokeOauthTokens}>
                          <input type="hidden" name="tenantId" value={id} />
                          <input type="hidden" name="clientId" value={clientId} />
                          <button className="text-xs text-danger hover:underline underline-offset-4">
                            Revoke all tokens
                          </button>
                        </ActionForm>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>No live OAuth tokens.</Empty>
            )}
          </Section>
        </div>
      </div>

      <Section title="History">
        {history.length ? (
          <table className="w-full">
            <tbody>
              {history.map((entry) => (
                <tr key={entry.id}>
                  <td className="adm-td tnum text-ink-faint w-40">{entry.createdAt.slice(0, 19).replace("T", " ")}</td>
                  <td className="adm-td adm-mono">{entry.action}</td>
                  <td className="adm-td text-ink-faint">{entry.adminEmail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>Nothing has been changed here from the console.</Empty>
        )}
      </Section>

      <DangerZone
        tenantId={id}
        slug={detail.tenant.slug}
        suspended={detail.subscription?.status === "suspended"}
        hasSubscription={Boolean(detail.subscription)}
      />
    </div>
  );
}
