"use client";

import { useActionState } from "react";
import { signIn } from "@/app/auth-actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, null as { error?: string } | null);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label className="adm-label" htmlFor="email">
          Email
        </label>
        <input className="adm-input" id="email" name="email" type="email" autoFocus required />
      </div>
      <div>
        <label className="adm-label" htmlFor="password">
          Password
        </label>
        <input className="adm-input" id="password" name="password" type="password" required />
      </div>
      {state?.error && <p className="text-sm text-danger">{state.error}</p>}
      <button className="adm-btn-primary w-full" disabled={pending}>
        {pending ? "Checking…" : "Sign in"}
      </button>
    </form>
  );
}
