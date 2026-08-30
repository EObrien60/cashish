"use client";

import { useState, useTransition } from "react";

export function RegisterForm({
  action,
}: {
  action: (formData: FormData) => Promise<{ error: string } | void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [password, setPassword] = useState("");

  // Length is the only rule enforced server-side, so it is the only one shown.
  // A meter that demands a symbol teaches people to write "Password1!".
  const remaining = Math.max(0, 12 - password.length);

  return (
    <div className="mk-doc rounded-xl p-6 sm:p-7">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          setError(null);
          // Success redirects, so only a failure ever comes back here.
          start(async () => {
            const result = await action(formData);
            if (result && "error" in result) setError(result.error);
          });
        }}
        className="space-y-4"
      >
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--ink-faint)]">
            Business name
          </span>
          <input
            name="businessName"
            required
            autoFocus
            placeholder="Harbour IT Systems Ltd"
            className="w-full rounded-lg border border-[color:var(--rule)] bg-white px-3 py-2.5 text-sm outline-none focus:border-[color:var(--brand)]"
          />
          <span className="mt-1 block text-xs text-[color:var(--ink-faint)]">
            This is the set of books. You can rename it or add another later.
          </span>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--ink-faint)]">
            Your name
          </span>
          <input
            name="name"
            className="w-full rounded-lg border border-[color:var(--rule)] bg-white px-3 py-2.5 text-sm outline-none focus:border-[color:var(--brand)]"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--ink-faint)]">
            Email
          </span>
          <input
            name="email"
            type="email"
            required
            autoComplete="username"
            className="w-full rounded-lg border border-[color:var(--rule)] bg-white px-3 py-2.5 text-sm outline-none focus:border-[color:var(--brand)]"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--ink-faint)]">
            Password
          </span>
          <input
            name="password"
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-[color:var(--rule)] bg-white px-3 py-2.5 text-sm outline-none focus:border-[color:var(--brand)]"
          />
          <span className="mt-1 block text-xs text-[color:var(--ink-faint)]">
            {remaining > 0
              ? `${remaining} more character${remaining === 1 ? "" : "s"} — twelve minimum.`
              : "Long enough. A passphrase beats a puzzle."}
          </span>
        </label>

        {error && (
          <p role="alert" className="text-sm text-[color:var(--out)]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mk-btn mk-btn-primary w-full disabled:opacity-60"
        >
          {pending ? "Setting things up…" : "Create my books"}
        </button>
      </form>
    </div>
  );
}
