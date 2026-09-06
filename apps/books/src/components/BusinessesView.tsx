"use client";

import { useState, useTransition } from "react";
import { Card } from "./ui";

type Business = { id: string; slug: string; name: string; role: string; kind?: string };

export function BusinessesView({
  businesses,
  activeId,
  createBusiness,
  switchTenant,
}: {
  businesses: Business[];
  activeId: string;
  createBusiness: (formData: FormData) => Promise<{ slug?: string; error?: string; kind?: string }>;
  switchTenant: (tenantId: string) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<"business" | "personal">("business");

  return (
    <div className="space-y-6">
      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2">Business</th>
              <th className="px-4 py-2">Slug</th>
              <th className="px-4 py-2">Your role</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {businesses.map((b) => (
              <tr key={b.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2 font-medium">
                  {b.name}
                  {b.kind === "personal" && (
                    <span className="ml-2 rounded bg-black/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-faint">
                      personal
                    </span>
                  )}
                  {b.id === activeId && (
                    <span className="ml-2 text-xs text-brand">current</span>
                  )}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-ink-faint">{b.slug}</td>
                <td className="px-4 py-2">{b.role}</td>
                <td className="px-4 py-2 text-right">
                  {b.id !== activeId && (
                    <button
                      type="button"
                      onClick={() => start(async () => { await switchTenant(b.id); })}
                      className="text-xs text-brand underline"
                    >
                      Switch to it
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold">Add a book</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            setError(null);
            start(async () => {
              const result = await createBusiness(formData);
              if (result?.error) setError(result.error);
            });
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="kind" value={kind} />
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium text-ink-soft">Name</span>
            <input
              name="name"
              required
              placeholder={kind === "personal" ? "Household" : "Second Company Ltd"}
              className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm"
            />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-ink-soft">Type</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as "business" | "personal")}
              className="rounded-lg border border-line bg-transparent px-3 py-2 text-sm"
            >
              <option value="business">Business</option>
              <option value="personal">Personal</option>
            </select>
          </label>
          <button type="submit" disabled={pending} className="btn-primary">
            {pending ? "Creating…" : "Create"}
          </button>
        </form>
        {error && (
          <p role="alert" className="mt-2 text-sm text-rose-600">
            {error}
          </p>
        )}
        <p className="mt-3 text-xs text-ink-faint">
          {kind === "personal"
            ? "A personal book has budgets and everyday categories, and no invoices, VAT or payroll. It begins empty — import a statement to fill it."
            : "You become its owner, and it starts with the Irish VAT rates and the default categories. It begins empty — import a statement to fill it."}
        </p>
      </Card>
    </div>
  );
}
