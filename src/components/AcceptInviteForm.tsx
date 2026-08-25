"use client";

import { useState, useTransition } from "react";
import { Card } from "./ui";

export function AcceptInviteForm({
  token,
  action,
}: {
  token: string;
  action: (token: string, formData: FormData) => Promise<{ error: string } | void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Card className="p-6">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          setError(null);
          start(async () => {
            const result = await action(token, formData);
            if (result && "error" in result) setError(result.error);
          });
        }}
        className="space-y-4"
      >
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-soft">Your name</span>
          <input
            name="name"
            className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-soft">
            Choose a password
          </span>
          <input
            name="password"
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-ink-faint">At least 12 characters.</span>
        </label>
        {error && (
          <p role="alert" className="text-sm text-rose-600">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending} className="btn-primary w-full justify-center">
          {pending ? "Joining…" : "Join"}
        </button>
      </form>
    </Card>
  );
}
