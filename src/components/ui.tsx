import { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="text-sm text-ink-faint mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "in" | "out" | "brand";
}) {
  const valueTone =
    tone === "in"
      ? "text-money-in"
      : tone === "out"
        ? "text-money-out"
        : tone === "brand"
          ? "text-brand"
          : "text-ink";
  return (
    <Card className="p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
        {label}
      </div>
      <div className={`mt-2 text-2xl font-bold tabular ${valueTone}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-faint">{sub}</div>}
    </Card>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="text-base font-semibold text-ink">{title}</div>
      {hint && <div className="max-w-sm text-sm text-ink-faint">{hint}</div>}
      {action}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-black/5 text-ink-soft",
  sent: "bg-blue-50 text-blue-700",
  partial: "bg-amber-50 text-amber-700",
  paid: "bg-brand-wash text-brand-dark",
  void: "bg-black/5 text-ink-faint line-through",
  overdue: "bg-money-out/10 text-money-out",
  finalised: "bg-brand-wash text-brand-dark",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${STATUS_STYLES[status] ?? STATUS_STYLES.draft}`}>
      <span className="capitalize">{status}</span>
    </span>
  );
}

export function Dot({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{ background: color }}
    />
  );
}
