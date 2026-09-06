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
  // Asked first, because it changes what the rest of the form is even for: a
  // household is not a business with the word "business" crossed out.
  const [kind, setKind] = useState<"business" | "personal">("business");
  const personal = kind === "personal";

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
        <input type="hidden" name="kind" value={kind} />

        <fieldset>
          <legend className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--ink-faint)]">
            What are you tracking?
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: "business" as const, title: "A business", blurb: "Invoices, VAT, payroll" },
              { value: "personal" as const, title: "Personal", blurb: "Budgets and spending" },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={kind === option.value}
                onClick={() => setKind(option.value)}
                className={`rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                  kind === option.value
                    ? "border-[color:var(--brand)] bg-[color:var(--brand)]/5"
                    : "border-[color:var(--rule)] bg-white hover:border-[color:var(--ink-faint)]"
                }`}
              >
                <span className="block font-medium">{option.title}</span>
                <span className="block text-xs text-[color:var(--ink-faint)]">{option.blurb}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--ink-faint)]">
            {personal ? "Name this book" : "Business name"}
          </span>
          <input
            name="businessName"
            required
            autoFocus
            placeholder={personal ? "Household" : "Harbour IT Systems Ltd"}
            className="w-full rounded-lg border border-[color:var(--rule)] bg-white px-3 py-2.5 text-sm outline-none focus:border-[color:var(--brand)]"
          />
          <span className="mt-1 block text-xs text-[color:var(--ink-faint)]">
            {personal
              ? "Budgets, categories and your ledger — no invoices or VAT."
              : "This is the set of books. You can rename it or add another later."}
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
