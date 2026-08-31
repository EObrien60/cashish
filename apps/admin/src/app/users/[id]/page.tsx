import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-session";
import { getUser } from "@/queries/users";
import { auditForSubject } from "@/lib/audit";
import { PageHeader, Section, RolePill, Empty, Back, when } from "@/components/ui";
import { setUserDisabled } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";

export const dynamic = "force-dynamic";

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const detail = await getUser(id);
  if (!detail) notFound();

  const history = await auditForSubject("user", id, 20);
  const disabled = Boolean(detail.user.disabledAt);

  return (
    <div>
      <div className="mb-3">
        <Back href="/users">← All users</Back>
      </div>
      <PageHeader
        title={detail.user.email}
        subtitle={`${detail.user.name || "no name"} · joined ${when(detail.user.createdAt)}`}
        right={
          <ActionForm action={setUserDisabled}>
            <input type="hidden" name="userId" value={id} />
            <input type="hidden" name="disabled" value={disabled ? "false" : "true"} />
            <button className={disabled ? "adm-btn-ghost" : "adm-btn-danger"}>
              {disabled ? "Re-enable this person" : "Disable this person"}
            </button>
          </ActionForm>
        }
      />

      {disabled && (
        <p className="text-sm text-danger bg-danger/5 border border-danger/20 rounded-md px-3 py-2 mb-6">
          Disabled {when(detail.user.disabledAt)}. They cannot sign in to any business, and any
          session they already had stopped working on its next request.
        </p>
      )}

      <Section title="Businesses">
        {detail.memberships.length ? (
          <table className="w-full">
            <tbody>
              {detail.memberships.map((m) => (
                <tr key={m.tenantId}>
                  <td className="adm-td">
                    <Link href={`/tenants/${m.tenantId}`} className="font-medium hover:underline underline-offset-4">
                      {m.tenantName}
                    </Link>
                    <div className="adm-mono">{m.slug}</div>
                  </td>
                  <td className="adm-td">
                    <RolePill role={m.role} />
                  </td>
                  <td className="adm-td tnum text-ink-faint">{when(m.joinedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>Not a member of any business.</Empty>
        )}
      </Section>

      <Section title="API keys they created">
        {detail.keys.length ? (
          <table className="w-full">
            <tbody>
              {detail.keys.map((key) => (
                <tr key={key.id}>
                  <td className="adm-td">
                    <div className="font-medium">{key.name || "(unnamed)"}</div>
                    <div className="adm-mono">{key.prefix}…</div>
                  </td>
                  <td className="adm-td adm-mono">{key.tenantSlug}</td>
                  <td className="adm-td">
                    <RolePill role={key.role} />
                  </td>
                  <td className="adm-td text-xs text-ink-faint">
                    {key.revokedAt ? "revoked" : "live"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>None.</Empty>
        )}
      </Section>

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
          <Empty>Nothing has been changed about this person from the console.</Empty>
        )}
      </Section>
    </div>
  );
}
