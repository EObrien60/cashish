"use client";

import { useActionState } from "react";

type Result = { error?: string; ok?: true };

/**
 * A form whose server action can refuse.
 *
 * Next requires a form's action to return void, which would mean either
 * throwing on a validation failure — an error page, for "that is the only
 * owner" — or swallowing it. Neither is right for a console where the refusals
 * are the interesting part: "type the slug exactly", "promote somebody else
 * first". This keeps the action's Result and renders the message in place.
 */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: (formData: FormData) => Promise<Result>;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(
    async (_previous: Result | null, formData: FormData) => action(formData),
    null as Result | null,
  );

  return (
    <form action={formAction} className={className} data-pending={pending || undefined}>
      {children}
      {state?.error && <p className="text-xs text-danger mt-1.5">{state.error}</p>}
    </form>
  );
}
