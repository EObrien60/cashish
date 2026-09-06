import type { MonthPoint } from "@/lib/account-analysis";
import { moneyIn } from "@/lib/format";

// Charts drawn with SVG and divs, no library — the same choice BarChart.tsx
// already made. A balance line and a pair of bars do not justify 40 kB of
// JavaScript on a page that is mostly numbers.

const monthLabel = (m: string) => {
  const [y, mm] = m.split("-");
  return `${["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(mm)]} ${y.slice(2)}`;
};

/**
 * Balance over time.
 *
 * The y-axis includes zero whenever the balance approaches or crosses it, so a
 * credit card going further into debt does not look like a rising line, and a
 * savings account is not drawn as though it started at its own minimum.
 */
export function BalanceChart({
  data,
  currency,
}: {
  data: MonthPoint[];
  currency: string;
}) {
  if (data.length < 2) {
    return (
      <div className="grid h-56 place-items-center text-sm text-ink-faint">
        One month of history so far — a line needs two.
      </div>
    );
  }

  const values = data.map((d) => d.closing);
  const rawMax = Math.max(...values);
  const rawMin = Math.min(...values);
  const max = Math.max(rawMax, 0);
  const min = Math.min(rawMin, 0);
  const span = max - min || 1;

  const W = 100;
  const H = 40;
  const x = (i: number) => (i / (data.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / span) * H;

  const line = data.map((d, i) => `${x(i).toFixed(2)},${y(d.closing).toFixed(2)}`).join(" ");
  const area = `0,${y(min).toFixed(2)} ${line} ${W},${y(min).toFixed(2)}`;
  const zeroY = y(0);
  const last = data[data.length - 1];
  const rising = last.closing >= data[0].closing;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-56 w-full">
        <polygon
          points={area}
          className={rising ? "fill-money-in/10" : "fill-money-out/10"}
        />
        {/* Zero only when it is actually in view; a gridline off the top of a
            chart is furniture. */}
        {min < 0 && max > 0 && (
          <line
            x1="0"
            x2={W}
            y1={zeroY}
            y2={zeroY}
            className="stroke-ink-faint/40"
            strokeWidth="0.3"
            strokeDasharray="1 1"
          />
        )}
        <polyline
          points={line}
          fill="none"
          className={rising ? "stroke-money-in" : "stroke-money-out"}
          strokeWidth="0.7"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      </svg>
      <div className="mt-2 flex justify-between text-[11px] text-ink-faint">
        <span>
          {monthLabel(data[0].month)} · {moneyIn(data[0].closing, currency)}
        </span>
        <span>
          {monthLabel(last.month)} · {moneyIn(last.closing, currency)}
        </span>
      </div>
    </div>
  );
}

/** Money in and out, month by month. */
export function InOutChart({ data, currency }: { data: MonthPoint[]; currency: string }) {
  if (data.length === 0) {
    return <div className="grid h-40 place-items-center text-sm text-ink-faint">Nothing yet.</div>;
  }
  // Only the last two years fit legibly; a savings account can be five years long.
  const shown = data.slice(-24);
  const max = Math.max(1, ...shown.map((d) => Math.max(d.in, d.out)));

  return (
    <div>
      <div className="flex h-40 items-end gap-1">
        {shown.map((d) => (
          <div key={d.month} className="flex h-full flex-1 flex-col items-center gap-1">
            <div className="flex w-full flex-1 items-end justify-center gap-[2px]">
              <div
                title={`${monthLabel(d.month)} · in ${moneyIn(d.in, currency)}`}
                className="w-1/2 rounded-t bg-money-in/80"
                style={{ height: `${(d.in / max) * 100}%` }}
              />
              <div
                title={`${monthLabel(d.month)} · out ${moneyIn(d.out, currency)}`}
                className="w-1/2 rounded-t bg-money-out/70"
                style={{ height: `${(d.out / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-ink-faint">
        <span>{monthLabel(shown[0].month)}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-money-in/80" /> in
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-money-out/70" /> out
          </span>
        </span>
        <span>{monthLabel(shown[shown.length - 1].month)}</span>
      </div>
    </div>
  );
}
