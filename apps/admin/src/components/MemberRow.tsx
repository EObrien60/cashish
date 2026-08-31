import Link from "next/link";
import { ROLES } from "@cashish/core/rbac";
import { setMemberRole, removeMember } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";

export function MemberRow({
  tenantId,
  member,
}: {
  tenantId: string;
  member: { userId: string; email: string; name: string; role: string; disabledAt: string | null };
}) {
  return (
    <tr>
      <td className="adm-td">
        <Link href={`/users/${member.userId}`} className="font-medium hover:underline underline-offset-4">
          {member.email}
        </Link>
        {member.disabledAt && (
          <span className="adm-pill bg-danger/10 text-danger ml-2">disabled</span>
        )}
        {member.name && <div className="text-xs text-ink-faint">{member.name}</div>}
      </td>
      <td className="adm-td">
        <ActionForm action={setMemberRole} className="flex items-center gap-2">
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="userId" value={member.userId} />
          <select name="role" defaultValue={member.role} className="adm-input py-1 w-32 text-xs">
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <button className="text-xs text-ink-faint hover:text-ink underline underline-offset-4">
            Save
          </button>
        </ActionForm>
      </td>
      <td className="adm-td text-right">
        <ActionForm action={removeMember}>
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="userId" value={member.userId} />
          <button className="text-xs text-danger hover:underline underline-offset-4">Remove</button>
        </ActionForm>
      </td>
    </tr>
  );
}
