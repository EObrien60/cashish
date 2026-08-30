import { redirect } from "next/navigation";
import { currentSession } from "@/lib/session";
import { can } from "@cashish/core/rbac";
import { listMembers, inviteMember, removeMember, changeMemberRole } from "../../auth-actions";
import { PageHeader } from "@/components/ui";
import { SettingsTabs } from "@/components/SettingsTabs";
import { TeamView } from "@/components/TeamView";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!can(session.role, "tenant:admin")) redirect("/settings");

  const members = await listMembers();
  return (
    <div>
      <PageHeader
        title="People"
        subtitle="Who can see and change these books. An accountant can work the books but not the settings."
      />
      <SettingsTabs />
      <TeamView
        members={members}
        currentUserId={session.userId}
        inviteMember={inviteMember}
        removeMember={removeMember}
        changeMemberRole={changeMemberRole}
      />
    </div>
  );
}
