"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CategoryRule, Category, VatRate } from "@cashish/core/db";
import { Card, EmptyState, Dot } from "@/components/ui";
import { Modal } from "@/components/Modal";
import {
  POSTINGS,
  POSTING_SPECS,
  TAX_KINDS,
  describePosting,
  isPosting,
  type Posting,
} from "@/lib/posting";
import {
  IconPlus,
  IconEdit,
  IconWand,
  IconArrowUp,
  IconArrowDown,
} from "@/components/icons";
import {
  saveRuleAction,
  deleteRuleAction,
  reorderRuleAction,
  applyRulesAction,
} from "@/app/actions";

type Props = {
  rules: CategoryRule[];
  categories: Category[];
  vatRates: VatRate[];
  uncategorizedCount: number;
  customers?: { id: string; name: string }[];
  vendors?: { id: string; name: string }[];
  people?: { id: string; name: string }[];
};

const FIELD_LABEL: Record<string, string> = {
  description: "Description",
  reference: "Reference",
  payer: "Payer",
  mcc: "MCC code",
  any: "Any text",
};
const TYPE_LABEL: Record<string, string> = {
  contains: "contains",
  equals: "equals",
  startsWith: "starts with",
  regex: "matches regex",
};

export function RulesView({
  rules,
  categories,
  vatRates,
  uncategorizedCount,
  customers = [],
  vendors = [],
  people = [],
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRule | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const catMap = new Map(categories.map((c) => [c.id, c]));
  const vatMap = new Map(vatRates.map((v) => [v.id, v]));

  const blank = {
    name: "",
    matchField: "description",
    matchType: "contains",
    matchValue: "",
    direction: "any",
    categoryId: categories[0]?.id ?? "",
    vatRateId: "",
    posting: "other" as Posting,
    customerId: "",
    vendorId: "",
    employeeId: "",
    taxKind: "vat",
    excludedReason: "",
    enabled: true,
  };
  const [form, setForm] = useState(blank);

  function openNew() {
    setEditing(null);
    setForm(blank);
    setOpen(true);
  }
  function openEdit(r: CategoryRule) {
    setEditing(r);
    setForm({
      name: r.name ?? "",
      matchField: r.matchField,
      matchType: r.matchType,
      matchValue: r.matchValue,
      direction: r.direction,
      categoryId: r.categoryId ?? "",
      vatRateId: r.vatRateId ?? "",
      posting: (isPosting(r.posting) ? r.posting : "other") as Posting,
      customerId: r.customerId ?? "",
      vendorId: r.vendorId ?? "",
      employeeId: r.employeeId ?? "",
      taxKind: r.taxKind ?? "vat",
      excludedReason: r.excludedReason ?? "",
      enabled: r.enabled,
    });
    setOpen(true);
  }
  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  function save() {
    if (!form.matchValue.trim()) return;
    startTransition(async () => {
      const result = await saveRuleAction({
        id: editing?.id,
        name: form.name,
        matchField: form.matchField,
        matchType: form.matchType,
        matchValue: form.matchValue,
        direction: form.direction,
        categoryId: form.categoryId || null,
        vatRateId: form.vatRateId || null,
        enabled: form.enabled,
        posting: form.posting,
        customerId: form.customerId || null,
        vendorId: form.vendorId || null,
        employeeId: form.employeeId || null,
        taxKind: form.taxKind || null,
        excludedReason: form.excludedReason || null,
      });
      if (result?.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }
  function del() {
    if (!editing) return;
    startTransition(async () => {
      await deleteRuleAction(editing.id);
      setOpen(false);
      router.refresh();
    });
  }
  function move(id: string, direction: "up" | "down") {
    startTransition(async () => {
      await reorderRuleAction(id, direction);
      router.refresh();
    });
  }
  function applyNow() {
    startTransition(async () => {
      const r = await applyRulesAction();
      const changed = `${r.updated} transaction${r.updated === 1 ? "" : "s"} categorised`;
      setApplied(
        r.recategorised > 0
          ? `Re-applied rules — ${changed}, ${r.recategorised} of them recategorised.`
          : `Re-applied rules — ${changed}.`,
      );
      router.refresh();
      setTimeout(() => setApplied(null), 4000);
    });
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-faint">
          Rules auto-categorise transactions on import and can be re-applied to
          existing ones. They run top to bottom — the first match wins. Applying
          them reaches transactions that already have a category, so correcting a
          rule fixes the history it got wrong; a category no rule matches is left
          alone, and excluded transactions are skipped.
        </p>
        <div className="flex gap-2">
          <button
            className="btn-outline"
            onClick={applyNow}
            disabled={rules.length === 0 || uncategorizedCount === 0}
          >
            <IconWand className="h-4 w-4" /> Apply to uncategorised
            {uncategorizedCount > 0 && ` (${uncategorizedCount})`}
          </button>
          <button className="btn-primary" onClick={openNew}>
            <IconPlus className="h-4 w-4" /> New rule
          </button>
        </div>
      </div>

      {applied && (
        <div className="mb-4 rounded-lg bg-brand-wash px-4 py-2.5 text-sm text-brand-dark">
          {applied}
        </div>
      )}

      <Card className="overflow-hidden">
        {rules.length === 0 ? (
          <EmptyState
            title="No rules yet"
            hint="Create a rule like “Description contains 'Github' → Software & subscriptions” and it'll tag matching transactions automatically."
            action={
              <button className="btn-primary" onClick={openNew}>
                <IconPlus className="h-4 w-4" /> New rule
              </button>
            }
          />
        ) : (
          <table className="w-full">
            <thead className="border-b border-line bg-paper/60">
              <tr>
                <th className="th w-16">Order</th>
                <th className="th">When</th>
                <th className="th">Posts as</th>
                <th className="th">Then categorise as</th>
                <th className="th">VAT</th>
                <th className="th text-right">Used</th>
                <th className="th w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rules.map((r, i) => {
                const cat = r.categoryId ? catMap.get(r.categoryId) : null;
                const posts = describePosting(r.posting, {
                  customer: customers.find((c) => c.id === r.customerId)?.name,
                  vendor: vendors.find((v) => v.id === r.vendorId)?.name,
                  employee: people.find((pp) => pp.id === r.employeeId)?.name,
                  taxKind: r.taxKind,
                });
                const vat = r.vatRateId ? vatMap.get(r.vatRateId) : null;
                return (
                  <tr key={r.id} className={`hover:bg-paper/50 ${r.enabled ? "" : "opacity-50"}`}>
                    <td className="td">
                      <div className="flex items-center gap-1">
                        <button
                          className="text-ink-faint hover:text-ink disabled:opacity-30"
                          disabled={i === 0}
                          onClick={() => move(r.id, "up")}
                        >
                          <IconArrowUp className="h-4 w-4" />
                        </button>
                        <button
                          className="text-ink-faint hover:text-ink disabled:opacity-30"
                          disabled={i === rules.length - 1}
                          onClick={() => move(r.id, "down")}
                        >
                          <IconArrowDown className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                    <td className="td">
                      {r.name && <div className="font-medium">{r.name}</div>}
                      <div className="text-sm">
                        <span className="text-ink-faint">{FIELD_LABEL[r.matchField]}</span>{" "}
                        {TYPE_LABEL[r.matchType]}{" "}
                        <span className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-xs">
                          {r.matchValue}
                        </span>
                        {r.direction !== "any" && (
                          <span className="ml-2 text-xs text-ink-faint">
                            ({r.direction === "in" ? "money in" : "money out"})
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="td text-sm">
                      <span
                        className={
                          r.posting === "other"
                            ? "text-ink-faint"
                            : r.posting === "transfer"
                              ? "text-ink-soft"
                              : "font-medium"
                        }
                      >
                        {posts}
                      </span>
                    </td>
                    <td className="td">
                      {cat ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Dot color={cat.color ?? "#9ca3af"} /> {cat.name}
                        </span>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="td text-ink-soft">{vat ? vat.name : "—"}</td>
                    <td className="td text-right tabular text-ink-faint">
                      {r.timesApplied}
                    </td>
                    <td className="td text-right">
                      <button className="btn-ghost px-2 py-1" onClick={() => openEdit(r)}>
                        <IconEdit className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit rule" : "New rule"}
        footer={
          <>
            {editing && (
              <button className="btn-danger mr-auto" onClick={del}>
                Delete
              </button>
            )}
            <button className="btn-outline" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={save}>
              Save rule
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label">Rule name (optional)</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Github subscriptions"
            />
          </div>
          <div className="rounded-lg border border-line bg-paper/50 p-3 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              When a transaction…
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Field</label>
                <select className="input" value={form.matchField} onChange={(e) => set("matchField", e.target.value)}>
                  {Object.entries(FIELD_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Condition</label>
                <select className="input" value={form.matchType} onChange={(e) => set("matchType", e.target.value)}>
                  {Object.entries(TYPE_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="label">Value</label>
              <input
                className="input font-mono"
                value={form.matchValue}
                onChange={(e) => set("matchValue", e.target.value)}
                placeholder="e.g. Github"
                autoFocus
              />
            </div>
            <div>
              <label className="label">Only apply to</label>
              <select className="input" value={form.direction} onChange={(e) => set("direction", e.target.value)}>
                <option value="any">Any transaction</option>
                <option value="out">Money out (expenses)</option>
                <option value="in">Money in (income)</option>
              </select>
            </div>
          </div>
          <div className="rounded-lg border border-line bg-paper/50 p-3 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              …categorise it as
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Category</label>
                <PostingFields
                form={form}
                set={set as unknown as (k: string, v: string) => void}
                customers={customers}
                vendors={vendors}
                people={people}
              />
              <select className="input" value={form.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
                  <option value="">— none —</option>
                  <optgroup label="Income">
                    {categories.filter((c) => c.kind === "income").map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Expense">
                    {categories.filter((c) => c.kind === "expense").map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </optgroup>
                </select>
              </div>
              <div>
                <label className="label">VAT rate</label>
                <select className="input" value={form.vatRateId} onChange={(e) => set("vatRateId", e.target.value)}>
                  <option value="">No VAT</option>
                  {vatRates.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-brand"
              checked={form.enabled}
              onChange={(e) => set("enabled", e.target.checked)}
            />
            Rule enabled
          </label>
        </div>
      </Modal>
    </div>
  );
}

/**
 * The posting kind, and whichever counterparty that kind requires.
 *
 * One field at a time on purpose: the kind decides what else is needed, so
 * showing all four references at once would invite exactly the mismatch the
 * kind exists to prevent.
 */
function PostingFields({
  form,
  set,
  customers,
  vendors,
  people,
}: {
  form: { posting: Posting; customerId: string; vendorId: string; employeeId: string; taxKind: string; excludedReason: string };
  /** A plain string setter; the caller narrows. */
  set: (k: string, v: string) => void;
  customers: { id: string; name: string }[];
  vendors: { id: string; name: string }[];
  people: { id: string; name: string }[];
}) {
  const spec = POSTING_SPECS[form.posting];
  const put = set;

  return (
    <>
      <label className="block">
        <span className="label">What is this?</span>
        <select
          className="input"
          value={form.posting}
          onChange={(e) => put("posting", e.target.value)}
        >
          {POSTINGS.map((id) => (
            <option key={id} value={id}>
              {POSTING_SPECS[id].label}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs leading-relaxed text-ink-faint">{spec.blurb}</span>
      </label>

      {spec.requires === "customer" && (
        <label className="block">
          <span className="label">Customer</span>
          <select className="input" value={form.customerId} onChange={(e) => put("customerId", e.target.value)}>
            <option value="">Choose a customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {spec.requires === "vendor" && (
        <label className="block">
          <span className="label">Vendor</span>
          <select className="input" value={form.vendorId} onChange={(e) => put("vendorId", e.target.value)}>
            <option value="">Choose a vendor…</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {spec.requires === "employee" && (
        <label className="block">
          <span className="label">Person</span>
          <select className="input" value={form.employeeId} onChange={(e) => put("employeeId", e.target.value)}>
            <option value="">Choose a person…</option>
            {people.map((pp) => (
              <option key={pp.id} value={pp.id}>
                {pp.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {spec.requires === "taxKind" && (
        <label className="block">
          <span className="label">Which tax</span>
          <select className="input" value={form.taxKind} onChange={(e) => put("taxKind", e.target.value)}>
            {TAX_KINDS.map((k) => (
              <option key={k} value={k}>
                {k.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
      )}

      {spec.excludes && (
        <label className="block">
          <span className="label">Why it is out of the books</span>
          <input
            className="input"
            value={form.excludedReason}
            placeholder="transfer to own tax pot"
            onChange={(e) => put("excludedReason", e.target.value)}
          />
          <span className="mt-1 block text-xs text-ink-faint">
            Recorded on every row it excludes. Someone will ask why this money is not in
            the accounts.
          </span>
        </label>
      )}
    </>
  );
}
