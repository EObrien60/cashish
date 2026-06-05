// EUR-only formatting + small numeric helpers. Money is held as floats in the
// DB but every display/aggregation rounds to cents to avoid drift.

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const eur = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
});

export function money(n: number | null | undefined): string {
  return eur.format(round2(n ?? 0));
}

// Signed, with explicit + for inflows — used in the transactions ledger.
export function moneySigned(n: number): string {
  const v = round2(n);
  const s = eur.format(Math.abs(v));
  return v < 0 ? `-${s}` : `+${s}`;
}

export function pct(rate: number): string {
  return `${round2(rate * 100)}%`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
