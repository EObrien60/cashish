"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/settings", label: "Business" },
  { href: "/settings/team", label: "People" },
  { href: "/settings/keys", label: "API keys" },
];

export function SettingsTabs() {
  const path = usePathname();
  return (
    <div className="mb-6 flex gap-1 border-b border-line">
      {TABS.map((tab) => {
        const active = path === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              active
                ? "border-brand text-brand-dark"
                : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
