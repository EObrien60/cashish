import Link from "next/link";
import { money } from "@/lib/format";
import { Card } from "./ui";

/** A signed change, formatted so the direction is unmistakable. */
export function Delta({
  value,
  unit = "%",
  goodWhenUp = true,
  suffix,
}: {
  value: number | null;
  unit?: "%" | "pts";
  goodWhenUp?: boolean;
  suffix?: string;
}) {
  if (value === null) {
    return <span className="text-xs text-ink-faint">no prior period</span>;
  }
  const flat = Math.abs(value) < 0.05;
  const good = goodWhenUp ? value > 0 : value < 0;
  const tone = flat ? "text-ink-faint" : good ? "text-money-in" : "text-money-out";
  const arrow = flat ? "→" : value > 0 ? "↑" : "↓";
  return (
    <span className={`text-xs font-medium ${tone}`}>
      {arrow} {Math.abs(value).toFixed(1)}
      {unit === "pts" ? " pts" : "%"}
      {suffix ? ` ${suffix}` : ""}
    </span>
  );
}

/** A headline figure with its comparison underneath. */
export function MetricCard({
  label,
  value,
  hint,
  delta,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: React.ReactNode;
  tone?: "default" | "in" | "out";
}) {
  const valueTone =
    tone === "in" ? "text-money-in" : tone === "out" ? "text-money-out" : "text-ink";
  return (
    <Card className="p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{label}</div>
      <div className={`mt-1.5 text-2xl font-bold tabular ${valueTone}`}>{value}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-2">
        {delta}
        {hint && <span className="text-xs text-ink-faint">{hint}</span>}
      </div>
    </Card>
  );
}

/**
 * A share bar. Widths are relative to the largest row rather than to the total,
 * so a long tail of small categories stays readable instead of collapsing into
 * a row of invisible slivers.
 */
export function ShareBar({
  value,
  max,
  color,
}: {
  value: number;
  max: number;
  color: string;
}) {
  const pct = max <= 0 ? 0 : Math.max(1.5, (value / max) * 100);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06]">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export function BasisNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 text-xs leading-relaxed text-ink-faint">
      {children}
    </p>
  );
}

export function UncategorisedWarning({
  count,
  income,
  expense,
}: {
  count: number;
  income: number;
  expense: number;
}) {
  if (count === 0) return null;
  return (
    <Card className="mt-4 border-amber-300 bg-amber-50/60 p-4">
      <p className="text-sm text-amber-900">
        <strong>{count} transaction{count === 1 ? "" : "s"}</strong> in this period have no
        category, so {money(income)} in and {money(expense)} out are counted in the totals
        but cannot be attributed. Every margin below is affected.{" "}
        <Link href="/transactions?filter=uncategorized" className="font-medium underline">
          Categorise them
        </Link>
        .
      </p>
    </Card>
  );
}
