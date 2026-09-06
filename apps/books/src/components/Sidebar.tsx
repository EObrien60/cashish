"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { can, type Role } from "@cashish/core/rbac";
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
  IconMenu,
  IconWand,
  IconPaperclip,
} from "./icons";

// Grouped like a macOS source list. The section labels are hidden on the web
// (see .nav-section in globals.css) and only appear in the desktop shell.
// `businessOnly` marks the trading half of the app. A personal book is the same
// ledger with that half switched off: there is nobody to invoice, no VAT return
// to file and no payroll to run, and showing those to someone budgeting their
// groceries is how an app feels like it was built for somebody else.
const SECTIONS: {
  label: string | null;
  items: {
    href: string;
    label: string;
    icon: (p: { className?: string }) => React.ReactNode;
    businessOnly?: boolean;
    personalOnly?: boolean;
  }[];
}[] = [
  { label: null, items: [{ href: "/", label: "Dashboard", icon: IconDashboard }] },
  {
    label: "Banking",
    items: [
      { href: "/accounts", label: "Accounts", icon: IconCoins },
      { href: "/transactions", label: "Transactions", icon: IconLedger },
      { href: "/rules", label: "Rules", icon: IconRules },
      { href: "/documents", label: "Documents", icon: IconPaperclip },
      { href: "/budget", label: "Budget", icon: IconCoins, personalOnly: true },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/invoices", label: "Invoices", icon: IconInvoice, businessOnly: true },
      { href: "/contracts", label: "Contracts", icon: IconInvoice, businessOnly: true },
      { href: "/customers", label: "Customers", icon: IconUsers, businessOnly: true },
      { href: "/products", label: "Products", icon: IconBox, businessOnly: true },
    ],
  },
  {
    label: "Purchases",
    items: [{ href: "/vendors", label: "Vendors", icon: IconBox, businessOnly: true }],
  },
  {
    label: "People",
    items: [{ href: "/payroll", label: "Payroll", icon: IconPayroll, businessOnly: true }],
  },
  {
    label: "Reporting",
    items: [
      { href: "/insights", label: "Where it went", icon: IconWand },
      { href: "/reports", label: "Reports", icon: IconReport },
      // The forecast is built from open invoices and recurring invoice
      // templates — a household has neither, so for a personal book it is a
      // sheet of repeating expenses and nothing else. Hidden until it has
      // something to say.
      { href: "/reports/cashflow", label: "Cash flow", icon: IconReport, businessOnly: true },
      { href: "/vat", label: "VAT return", icon: IconVat, businessOnly: true },
    ],
  },
  { label: null, items: [{ href: "/settings", label: "Settings", icon: IconSettings }] },
];

type Props = {
  role: Role;
  kind: string;
  tenants: { id: string; name: string }[];
  activeTenantId: string | null;
  switchTenant: (tenantId: string) => Promise<void>;
  logout: () => Promise<void>;
};

export function Sidebar({ role, kind, tenants, activeTenantId, switchTenant, logout }: Props) {
  const personal = kind === "personal";
  const path = usePathname();
  const [, start] = useTransition();

  // Two different behaviours behind one component, because they are the same
  // navigation: below `lg` the sidebar is a drawer over the page, and at `lg`
  // and up it is a column that can be narrowed to icons.
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // The width the page has to leave for it lives in one place — a data
  // attribute on <html> that globals.css reads — because `main` is rendered by
  // a server component and cannot see this state.
  useEffect(() => {
    document.documentElement.dataset.sidebar = collapsed ? "collapsed" : "expanded";
  }, [collapsed]);

  // Restore the choice; a sidebar that reopens on every navigation is worse
  // than one that never collapses.
  useEffect(() => {
    setCollapsed(window.localStorage.getItem("cashish:sidebar") === "collapsed");
  }, []);

  function toggleCollapsed() {
    setCollapsed((v) => {
      window.localStorage.setItem("cashish:sidebar", v ? "expanded" : "collapsed");
      return !v;
    });
  }

  // Following a link on a phone must close the drawer, or the page you asked
  // for is behind the thing you asked it from.
  useEffect(() => {
    setOpen(false);
  }, [path]);

  // Escape closes it, which is the one keyboard convention every drawer has.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const isActive = (href: string) =>
    href === "/" ? path === "/" : path.startsWith(href);

  // A viewer is shown the whole navigation but the write affordances inside each
  // page are gated; hiding Settings would just make the app look broken to them.
  const visible = SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (personal ? item.businessOnly : item.personalOnly) return false;
      return item.href !== "/settings" || can(role, "settings:write") || can(role, "tenant:admin");
    }),
  })).filter((section) => section.items.length > 0);

  return (
    <>
      {/* The bar that exists only on a phone: somewhere for the button to be,
          and somewhere for the page to say what it is. */}
      <div className="no-print fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-card px-4 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          aria-expanded={open}
          className="grid h-9 w-9 place-items-center rounded-lg border border-line"
        >
          <IconMenu className="h-5 w-5" />
        </button>
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-white">
          <IconCoins className="h-4 w-4" />
        </span>
        <span className="font-bold tracking-tight">cashish</span>
      </div>

      {open && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
          className="no-print fixed inset-0 z-30 bg-black/30 lg:hidden"
        />
      )}

    <aside
      className={`no-print fixed inset-y-0 left-0 z-40 flex flex-col border-r border-line bg-card transition-transform duration-200 lg:translate-x-0 ${
        open ? "translate-x-0" : "-translate-x-full"
      } ${collapsed ? "w-60 lg:w-16" : "w-60"}`}
    >
      <div
        className={`sidebar-head flex h-16 items-center gap-2.5 border-b border-line ${
          collapsed ? "px-5 lg:justify-center lg:px-0" : "px-5"
        }`}
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand text-white">
          <IconCoins className="h-5 w-5" />
        </span>
        <div className={collapsed ? "lg:hidden" : ""}>
          <div className="text-lg font-bold leading-none tracking-tight">
            cashish
          </div>
          <div className="text-[10px] uppercase tracking-widest text-ink-faint mt-1">
            books, sorted
          </div>
        </div>
      </div>

      {tenants.length > 1 && (
        <div className={`border-b border-line px-3 py-2 ${collapsed ? "lg:hidden" : ""}`}>
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
                    title={collapsed ? item.label : undefined}
                    className={`flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition-colors ${
                      collapsed ? "px-3 lg:justify-center lg:px-0" : "px-3"
                    } ${
                      active
                        ? "bg-brand-wash text-brand-dark"
                        : "text-ink-soft hover:bg-black/[0.04]"
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    {/* The drawer always shows labels; only the desktop column
                        narrows, so this hides at lg and not below it. */}
                    <span className={collapsed ? "lg:hidden" : ""}>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className={`border-t border-line ${collapsed ? "p-4 lg:p-2" : "p-4"}`}>
        {/* Only at lg: on a phone the drawer closes instead of narrowing. */}
        <button
          type="button"
          onClick={toggleCollapsed}
          className="mb-3 hidden w-full items-center justify-center rounded-lg border border-line py-1.5 text-[11px] text-ink-faint hover:text-ink lg:flex"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? "»" : "« Collapse"}
        </button>
        <div className={collapsed ? "lg:hidden" : ""}>
          {tenants.length === 1 && (
            <div className="mb-2 truncate text-xs font-medium">{tenants[0].name}</div>
          )}
          <Link
            href="/businesses"
            className="mb-2 block text-[11px] text-ink-faint underline hover:text-ink"
          >
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
      </div>
    </aside>
    </>
  );
}
