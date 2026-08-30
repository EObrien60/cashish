"use client";

import { useState, useTransition } from "react";
import { Card } from "./ui";
import type { Role } from "@cashish/core/rbac";

type Member = { userId: string; email: string; name: string; role: string };

export function TeamView({
  members,
  currentUserId,
  inviteMember,
  removeMember,
  changeMemberRole,
}: {
  members: Member[];
  currentUserId: string;
  inviteMember: (formData: FormData) => Promise<{ link?: string; error?: string } | void>;
  removeMember: (userId: string) => Promise<{ error?: string } | void>;
  changeMemberRole: (userId: string, role: Role) => Promise<{ error?: string } | void>;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ error?: string } | void>) =>
    start(async () => {
      setError(null);
      const result = await fn();
      if (result && "error" in result && result.error) setError(result.error);
    });

  return (
    <div className="space-y-6">
      {link && (
        <Card className="border-brand p-4">
          <p className="text-sm font-medium">Send this invitation link to them.</p>
          <code className="mt-2 block break-all rounded-lg bg-black/[0.05] p-3 text-xs">{link}</code>
          <p className="mt-2 text-xs text-ink-faint">
            Valid for 7 days, and usable once. cashish does not send email — pass it on however
            you like.
          </p>
          <button type="button" onClick={() => setLink(null)} className="mt-3 text-xs text-ink-faint underline">
            Done
          </button>
        </Card>
      )}

      <Card className="p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            const form = event.currentTarget;
            setError(null);
            start(async () => {
              const result = await inviteMember(formData);
              if (result && "error" in result && result.error) setError(result.error);
              if (result && "link" in result && result.link) {
                setLink(result.link);
                form.reset();
              }
            });
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium text-ink-soft">Email</span>
            <input
              name="email"
              type="email"
              required
              placeholder="accountant@example.com"
              className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm"
            />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-ink-soft">Role</span>
            <select
              name="role"
              defaultValue="accountant"
              className="rounded-lg border border-line bg-transparent px-3 py-2 text-sm"
            >
              <option value="viewer">viewer — read only</option>
              <option value="accountant">accountant — can change the books</option>
              <option value="owner">owner — everything</option>
            </select>
          </label>
          <button type="submit" disabled={pending} className="btn-primary">
            {pending ? "Creating…" : "Create invitation"}
          </button>
        </form>
      </Card>

      {error && (
        <p role="alert" className="text-sm text-rose-600">
          {error}
        </p>
      )}

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2">Person</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId} className="border-b border-line last:border-0">
                <td className="px-4 py-2">
                  {m.name || m.email}
                  {m.userId === currentUserId && (
                    <span className="ml-2 text-xs text-ink-faint">(you)</span>
                  )}
                  {m.name && <div className="text-xs text-ink-faint">{m.email}</div>}
                </td>
                <td className="px-4 py-2">
                  <select
                    defaultValue={m.role}
                    onChange={(event) =>
                      run(() => changeMemberRole(m.userId, event.target.value as Role))
                    }
                    className="rounded-lg border border-line bg-transparent px-2 py-1 text-sm"
                  >
                    <option value="viewer">viewer</option>
                    <option value="accountant">accountant</option>
                    <option value="owner">owner</option>
                  </select>
                </td>
                <td className="px-4 py-2 text-right">
                  {m.userId !== currentUserId && (
                    <button
                      type="button"
                      onClick={() => run(() => removeMember(m.userId))}
                      className="text-xs text-rose-600 underline"
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
