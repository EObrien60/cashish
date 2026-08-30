"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "./ui";
import { IconPlus } from "./icons";

/**
 * Adding a person by name alone.
 *
 * The full employee dialog asks for PPSN, PRSI class and pay frequency, all of
 * which matter when filing PAYE and none of which matter when you just want to
 * record that a payment went to someone. This is the short path.
 */
export function PeopleQuickAdd({
  action,
}: {
  action: (formData: FormData) => Promise<{ id?: string; created?: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Card className="mb-4 p-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const form = event.currentTarget;
          setError(null);
          setNote(null);
          start(async () => {
            const result = await action(formData);
            if (result?.error) {
              setError(result.error);
              return;
            }
            setNote(result?.created ? "Added." : "That person already exists.");
            form.reset();
            router.refresh();
          });
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="min-w-52 flex-1">
          <span className="mb-1 block text-xs font-medium text-ink-soft">Name</span>
          <input
            name="name"
            required
            placeholder="Sarah Jane Hughes"
            className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-ink-soft">Email (optional)</span>
          <input
            name="email"
            type="email"
            className="rounded-lg border border-line bg-transparent px-3 py-2 text-sm"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-ink-soft">Started (optional)</span>
          <input
            name="startDate"
            type="date"
            className="rounded-lg border border-line bg-transparent px-3 py-2 text-sm"
          />
        </label>
        <button type="submit" disabled={pending} className="btn-primary">
          <IconPlus className="h-4 w-4" /> {pending ? "Adding…" : "Add person"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-rose-600">
          {error}
        </p>
      )}
      {note && <p className="mt-2 text-sm text-ink-faint">{note}</p>}
    </Card>
  );
}
