import Link from "next/link";

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 mb-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-ink-faint mt-1">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

/** Subscription status, coloured by how much attention it wants. */
export function StatusPill({ status }: { status: string | null }) {
  if (!status) {
    return <span className="adm-pill bg-paper text-ink-faint border border-line">none</span>;
  }
  const tone =
    status === "active"
      ? "bg-ok/10 text-ok"
      : status === "trialing"
        ? "bg-accent-wash text-accent"
        : status === "past_due"
          ? "bg-warn/10 text-warn"
          : "bg-danger/10 text-danger";
  return <span className={`adm-pill ${tone}`}>{status}</span>;
}

export function RolePill({ role }: { role: string }) {
  const tone =
    role === "owner" ? "bg-ink text-white" : role === "accountant" ? "bg-paper text-ink-soft border border-line" : "bg-paper text-ink-faint border border-line";
  return <span className={`adm-pill ${tone}`}>{role}</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-faint px-3 py-6">{children}</p>;
}

export function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="adm-card overflow-hidden mb-6">
      <div className="px-3 py-2 border-b border-line flex items-center justify-between bg-paper/60">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Search({ action, placeholder, defaultValue }: { action: string; placeholder: string; defaultValue?: string }) {
  return (
    <form action={action} className="flex gap-2">
      <input
        className="adm-input w-72"
        type="search"
        name="q"
        placeholder={placeholder}
        defaultValue={defaultValue}
      />
      <button className="adm-btn-ghost">Search</button>
    </form>
  );
}

export function Back({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-sm text-ink-faint hover:text-ink underline underline-offset-4">
      {children}
    </Link>
  );
}

/** ISO strings, shown short. The database stores them as text by convention. */
export function when(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 10);
}
