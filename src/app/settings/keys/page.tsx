import { redirect } from "next/navigation";
import { currentSession } from "@/lib/session";
import { can } from "@/lib/rbac";
import { listApiKeys } from "@/lib/auth";
import { createKey, revokeKey } from "../../auth-actions";
import { PageHeader } from "@/components/ui";
import { SettingsTabs } from "@/components/SettingsTabs";
import { ApiKeysView } from "@/components/ApiKeysView";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  // Keys grant access to the books; only an owner may see or mint them.
  if (!can(session.role, "tenant:admin")) redirect("/settings");

  const keys = await listApiKeys(session.tenantId);
  return (
    <div>
      <PageHeader
        title="API keys"
        subtitle="For scripts and MCP clients. A key carries its own role, so a read-only key stays read-only."
      />
      <SettingsTabs />
      <ApiKeysView
        keys={keys.map((k) => ({
          id: k.id,
          name: k.name,
          role: k.role,
          prefix: k.prefix,
          lastUsedAt: k.lastUsedAt,
          revokedAt: k.revokedAt,
          createdAt: k.createdAt,
        }))}
        createKey={createKey}
        revokeKey={revokeKey}
      />
    </div>
  );
}
