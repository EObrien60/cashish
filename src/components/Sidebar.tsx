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
} from "./icons";

const NAV = [
  { href: "/", label: "Dashboard", icon: IconDashboard },
  { href: "/transactions", label: "Transactions", icon: IconLedger },
  { href: "/rules", label: "Rules", icon: IconRules },
  { href: "/invoices", label: "Invoices", icon: IconInvoice },
  { href: "/customers", label: "Customers", icon: IconUsers },
  { href: "/products", label: "Products", icon: IconBox },
  { href: "/reports", label: "Reports", icon: IconReport },
  { href: "/vat", label: "VAT return", icon: IconVat },
  { href: "/settings", label: "Settings", icon: IconSettings },
];

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="no-print fixed inset-y-0 left-0 flex w-60 flex-col border-r border-line bg-card">
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-line">
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
      <nav className="flex-1 space-y-1 p-3">
        {NAV.map((item) => {
          const active =
            item.href === "/"
              ? path === "/"
              : path.startsWith(item.href);
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
      </nav>
      <div className="p-4 text-[11px] text-ink-faint border-t border-line">
        EUR · Ireland · cash basis VAT
      </div>
    </aside>
  );
}
