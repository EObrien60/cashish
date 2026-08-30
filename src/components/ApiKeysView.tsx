"use client";

import { useState, useTransition } from "react";
import { Card, EmptyState } from "./ui";

type Key = {
  id: string;
  name: string;
  role: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export function ApiKeysView({
  keys,
  createKey,
  revokeKey,
}: {
  keys: Key[];
  createKey: (formData: FormData) => Promise<{ key?: string; error?: string }>;
  revokeKey: (id: string) => Promise<void>;
}) {
  const [issued, setIssued] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const live = keys.filter((k) => !k.revokedAt);
  const revoked = keys.filter((k) => k.revokedAt);

  return (
    <div className="space-y-6">
      {issued && (
        <Card className="border-brand p-4">
          <p className="text-sm font-medium">
            Copy this now — it is not shown again and cannot be recovered.
          </p>
          <code className="mt-2 block break-all rounded-lg bg-black/[0.05] p-3 text-xs">
            {issued}
          </code>
          <button
            type="button"
            onClick={() => setIssued(null)}
            className="mt-3 text-xs text-ink-faint underline"
          >
            I have copied it
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
              const result = await createKey(formData);
              if (result?.error) setError(result.error);
              if (result?.key) {
                setIssued(result.key);
                form.reset();
              }
            });
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium text-ink-soft">Label</span>
            <input
              name="name"
              placeholder="claude code"
              className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm"
            />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-ink-soft">Role</span>
            <select
              name="role"
              defaultValue="viewer"
              className="rounded-lg border border-line bg-transparent px-3 py-2 text-sm"
            >
              <option value="viewer">viewer — read only</option>
              <option value="accountant">accountant — can change the books</option>
              <option value="owner">owner — everything</option>
            </select>
          </label>
          <button type="submit" disabled={pending} className="btn-primary">
            {pending ? "Creating…" : "Create key"}
          </button>
        </form>
        {error && (
          <p role="alert" className="mt-2 text-sm text-rose-600">
            {error}
          </p>
        )}
      </Card>

      {live.length === 0 ? (
        <EmptyState title="No keys yet" hint="Create one to connect a script or an MCP client." />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2">Label</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Key</th>
                <th className="px-4 py-2">Last used</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {live.map((k) => (
                <tr key={k.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2">{k.name}</td>
                  <td className="px-4 py-2">{k.role}</td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-faint">
                    ck_live_{k.prefix}…
                  </td>
                  <td className="px-4 py-2 text-ink-soft">{k.lastUsedAt ?? "never"}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => start(async () => { await revokeKey(k.id); })}
                      className="text-xs text-rose-600 underline"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {revoked.length > 0 && (
        <p className="text-xs text-ink-faint">
          {revoked.length} revoked key{revoked.length === 1 ? "" : "s"} kept for the record.
        </p>
      )}
    </div>
  );
}
