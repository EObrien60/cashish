"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

export function Sidebar() {
  const path = usePathname();
  const isActive = (href: string) =>
    href === "/" ? path === "/" : path.startsWith(href);

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

      <nav className="flex-1 overflow-y-auto p-3">
        {SECTIONS.map((section, i) => (
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

      <div className="p-4 text-[11px] text-ink-faint border-t border-line">
        EUR · Ireland · cash basis VAT
      </div>
    </aside>
  );
}
