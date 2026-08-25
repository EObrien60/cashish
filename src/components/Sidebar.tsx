"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { can, type Role } from "@/lib/rbac";
import {
  IconDashboard,
  IconLedger,
  IconInvoice,
  IconUsers,
  IconBox,
  IconReport,
  IconVat,
  IconSettings,
  IconCoins,
  IconRules,
  IconPayroll,
} from "./icons";

// Grouped like a macOS source list. The section labels are hidden on the web
// (see .nav-section in globals.css) and only appear in the desktop shell.
const SECTIONS: {
  label: string | null;
  items: { href: string; label: string; icon: (p: { className?: string }) => React.ReactNode }[];
}[] = [
  { label: null, items: [{ href: "/", label: "Dashboard", icon: IconDashboard }] },
  {
    label: "Banking",
    items: [
      { href: "/transactions", label: "Transactions", icon: IconLedger },
      { href: "/rules", label: "Rules", icon: IconRules },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/invoices", label: "Invoices", icon: IconInvoice },
      { href: "/customers", label: "Customers", icon: IconUsers },
      { href: "/products", label: "Products", icon: IconBox },
    ],
  },
  { label: "People", items: [{ href: "/payroll", label: "Payroll", icon: IconPayroll }] },
  {
    label: "Reporting",
    items: [
      { href: "/reports", label: "Reports", icon: IconReport },
      { href: "/vat", label: "VAT return", icon: IconVat },
    ],
  },
  { label: null, items: [{ href: "/settings", label: "Settings", icon: IconSettings }] },
];

type Props = {
  role: Role;
  tenants: { id: string; name: string }[];
  activeTenantId: string | null;
  switchTenant: (tenantId: string) => Promise<void>;
  logout: () => Promise<void>;
};

export function Sidebar({ role, tenants, activeTenantId, switchTenant, logout }: Props) {
  const path = usePathname();
  const [, start] = useTransition();
  const isActive = (href: string) =>
    href === "/" ? path === "/" : path.startsWith(href);

  // A viewer is shown the whole navigation but the write affordances inside each
  // page are gated; hiding Settings would just make the app look broken to them.
  const visible = SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => item.href !== "/settings" || can(role, "settings:write") || can(role, "tenant:admin"),
    ),
  })).filter((section) => section.items.length > 0);

  return (
    <aside className="no-print fixed inset-y-0 left-0 flex w-60 flex-col border-r border-line bg-card">
      <div className="sidebar-head flex items-center gap-2.5 px-5 h-16 border-b border-line">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-white">
          <IconCoins className="h-5 w-5" />
        </span>
        <div>
          <div className="text-lg font-bold leading-none tracking-tight">
            cashish
          </div>
          <div className="text-[10px] uppercase tracking-widest text-ink-faint mt-1">
            books, sorted
          </div>
        </div>
      </div>

      {tenants.length > 1 && (
        <div className="border-b border-line px-3 py-2">
          <label className="sr-only" htmlFor="tenant-switch">
            Business
          </label>
          <select
            id="tenant-switch"
            value={activeTenantId ?? ""}
            onChange={(event) => {
              const next = event.target.value;
              start(async () => {
                await switchTenant(next);
              });
            }}
            className="w-full rounded-lg border border-line bg-transparent px-2 py-1.5 text-sm"
          >
            {tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto p-3">
        {visible.map((section, i) => (
          <div key={i} className="nav-group">
            {section.label && (
              <div className="nav-section">{section.label}</div>
            )}
            <div className="space-y-1">
              {section.items.map((item) => {
                const active = isActive(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      active
                        ? "bg-brand-wash text-brand-dark"
                        : "text-ink-soft hover:bg-black/[0.04]"
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-line p-4">
        {tenants.length === 1 && (
          <div className="mb-2 truncate text-xs font-medium">{tenants[0].name}</div>
        )}
        <Link href="/businesses" className="mb-2 block text-[11px] text-ink-faint underline hover:text-ink">
          Businesses
        </Link>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] uppercase tracking-wide text-ink-faint">{role}</span>
          <button
            type="button"
            onClick={() => start(async () => { await logout(); })}
            className="text-[11px] text-ink-faint underline hover:text-ink"
          >
            Sign out
          </button>
        </div>
        <div className="mt-2 text-[11px] text-ink-faint">EUR · Ireland · cash basis VAT</div>
      </div>
    </aside>
  );
}
