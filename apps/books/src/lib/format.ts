// Money formatting. Held as floats in the DB, but every display and every
// aggregation rounds to cents to avoid drift.
//
// EUR is the default because the books are Irish, but accounts brought a second
// currency into the same page: an account named "Main · GBP" holding sterling
// must not be printed with a euro sign, which is a lie about the number rather
// than a formatting nicety.

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

const formatters = new Map<string, Intl.NumberFormat>([["EUR", eur]]);

/** Formats in a given currency, falling back to EUR. */
export function moneyIn(n: number | null | undefined, currency: string | null | undefined): string {
  const code = (currency || "EUR").toUpperCase();
  let f = formatters.get(code);
  if (!f) {
    try {
      f = new Intl.NumberFormat("en-IE", { style: "currency", currency: code });
    } catch {
      // An unknown code must not take a page down over a label.
      f = eur;
    }
    formatters.set(code, f);
  }
  return f.format(round2(n ?? 0));
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
