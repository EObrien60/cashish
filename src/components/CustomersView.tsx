"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Customer } from "@/db/schema";
import { Card, EmptyState } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { IconPlus, IconEdit } from "@/components/icons";
import { saveCustomer, archiveCustomer } from "@/app/actions";

const EMPTY = {
  name: "",
  email: "",
  vatNumber: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  country: "Ireland",
  notes: "",
};

export function CustomersView({ customers }: { customers: Customer[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState(EMPTY);

  function openNew() {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  }
  function openEdit(c: Customer) {
    setEditing(c);
    setForm({
      name: c.name,
      email: c.email ?? "",
      vatNumber: c.vatNumber ?? "",
      addressLine1: c.addressLine1 ?? "",
      addressLine2: c.addressLine2 ?? "",
      city: c.city ?? "",
      country: c.country ?? "Ireland",
      notes: c.notes ?? "",
    });
    setOpen(true);
  }

  function save() {
    if (!form.name.trim()) return;
    startTransition(async () => {
      await saveCustomer({ id: editing?.id, ...form });
      setOpen(false);
      router.refresh();
    });
  }

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const active = customers.filter((c) => !c.archived);

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button className="btn-primary" onClick={openNew}>
          <IconPlus className="h-4 w-4" /> New customer
        </button>
      </div>

      <Card className="overflow-hidden">
        {active.length === 0 ? (
          <EmptyState
            title="No customers yet"
            hint="Add a customer to start invoicing."
            action={
              <button className="btn-primary" onClick={openNew}>
                <IconPlus className="h-4 w-4" /> New customer
              </button>
            }
          />
        ) : (
          <table className="w-full">
            <thead className="border-b border-line bg-paper/60">
              <tr>
                <th className="th">Name</th>
                <th className="th">Email</th>
                <th className="th">VAT number</th>
                <th className="th">Location</th>
                <th className="th w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {active.map((c) => (
                <tr key={c.id} className="hover:bg-paper/50">
                  <td className="td font-medium">{c.name}</td>
                  <td className="td text-ink-soft">{c.email || "—"}</td>
                  <td className="td text-ink-soft tabular">
                    {c.vatNumber || "—"}
                  </td>
                  <td className="td text-ink-soft">
                    {[c.city, c.country].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="td text-right">
                    <button
                      className="btn-ghost px-2 py-1"
                      onClick={() => openEdit(c)}
                    >
                      <IconEdit className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit customer" : "New customer"}
        footer={
          <>
            {editing && (
              <button
                className="btn-danger mr-auto"
                onClick={() =>
                  startTransition(async () => {
                    await archiveCustomer(editing.id, true);
                    setOpen(false);
                    router.refresh();
                  })
                }
              >
                Archive
              </button>
            )}
            <button className="btn-outline" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={save}>
              Save
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label">Name</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Acme Ltd"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="billing@acme.com"
              />
            </div>
            <div>
              <label className="label">VAT number</label>
              <input
                className="input"
                value={form.vatNumber}
                onChange={(e) => set("vatNumber", e.target.value)}
                placeholder="IE1234567X"
              />
            </div>
          </div>
          <div>
            <label className="label">Address line 1</label>
            <input
              className="input"
              value={form.addressLine1}
              onChange={(e) => set("addressLine1", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Address line 2</label>
              <input
                className="input"
                value={form.addressLine2}
                onChange={(e) => set("addressLine2", e.target.value)}
              />
            </div>
            <div>
              <label className="label">City</label>
              <input
                className="input"
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="label">Country</label>
            <input
              className="input"
              value={form.country}
              onChange={(e) => set("country", e.target.value)}
            />
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea
              className="input min-h-[70px]"
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
