import Link from "next/link";
import { periods } from "@/lib/period";

export function PeriodTabs({
  active,
  basePath,
}: {
  active: string;
  basePath: string;
}) {
  return (
    <div className="seg inline-flex rounded-lg border border-line bg-card p-1 text-sm">
      {periods().map((p) => (
        <Link
          key={p.key}
          href={`${basePath}?period=${p.key}`}
          className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
            active === p.key
              ? "bg-brand text-white"
              : "text-ink-soft hover:bg-black/5"
          }`}
        >
          {p.label}
        </Link>
      ))}
    </div>
  );
}
