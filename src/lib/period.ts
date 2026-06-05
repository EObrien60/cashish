import { todayISO } from "./format";

export type Period = { from: string; to: string; label: string; key: string };

// Derive named periods relative to a reference date (defaults to today). Kept
// pure so it works the same on server and client.
export function periods(refISO = todayISO()): Period[] {
  const ref = new Date(refISO + "T00:00:00Z");
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth();
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const startOfYear = new Date(Date.UTC(y, 0, 1));
  const startOfQuarter = new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1));
  const startOfMonth = new Date(Date.UTC(y, m, 1));
  const last12 = new Date(Date.UTC(y, m - 11, 1));

  return [
    { key: "month", label: "This month", from: iso(startOfMonth), to: refISO },
    { key: "quarter", label: "This quarter", from: iso(startOfQuarter), to: refISO },
    { key: "ytd", label: "Year to date", from: iso(startOfYear), to: refISO },
    { key: "12m", label: "Last 12 months", from: iso(last12), to: refISO },
    { key: "all", label: "All time", from: "1970-01-01", to: "2999-12-31" },
  ];
}

export function resolvePeriod(key: string | undefined, refISO?: string): Period {
  const list = periods(refISO);
  return list.find((p) => p.key === key) ?? list[2]; // default YTD
}

// VAT periods are bi-monthly in Ireland by default (Jan/Feb, Mar/Apr, ...).
export function vatPeriods(year: number): Period[] {
  const out: Period[] = [];
  const labels = ["Jan–Feb", "Mar–Apr", "May–Jun", "Jul–Aug", "Sep–Oct", "Nov–Dec"];
  for (let i = 0; i < 6; i++) {
    const startMonth = i * 2;
    const from = new Date(Date.UTC(year, startMonth, 1));
    const to = new Date(Date.UTC(year, startMonth + 2, 0));
    out.push({
      key: `${year}-p${i + 1}`,
      label: `${labels[i]} ${year}`,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    });
  }
  return out;
}
