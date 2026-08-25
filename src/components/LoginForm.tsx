"use client";

import { useState, useTransition } from "react";
import { Card } from "./ui";

export function LoginForm({
  action,
  next,
}: {
  action: (formData: FormData) => Promise<{ error: string } | void>;
  next: string;
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
          // A successful login redirects, so only a failure ever returns here.
          start(async () => {
            const result = await action(formData);
            if (result && "error" in result) setError(result.error);
          });
        }}
        className="space-y-4"
      >
        <input type="hidden" name="next" value={next} />
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-soft">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="username"
            autoFocus
            className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-soft">Password</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-rose-600">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending} className="btn-primary w-full justify-center">
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </Card>
  );
}
