import type { MonthPoint } from "@/lib/reports";
import { money } from "@/lib/format";

// Dependency-free dual-bar (in/out) chart drawn with flexbox + divs.
export function CashflowChart({ data }: { data: MonthPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="grid h-48 place-items-center text-sm text-ink-faint">
        No transactions in this period.
      </div>
    );
  }
  const max = Math.max(1, ...data.map((d) => Math.max(d.income, d.expense)));
  return (
    <div>
      <div className="flex items-end gap-3 h-48 px-1">
        {data.map((d) => (
          <div key={d.month} className="flex h-full flex-1 flex-col items-center gap-1">
            <div className="flex w-full flex-1 items-end justify-center gap-1">
              <div
                title={`In ${money(d.income)}`}
                className="w-1/2 max-w-[18px] rounded-t bg-money-in/80 transition-all hover:bg-money-in"
                style={{ height: `${(d.income / max) * 100}%` }}
              />
              <div
                title={`Out ${money(d.expense)}`}
                className="w-1/2 max-w-[18px] rounded-t bg-money-out/70 transition-all hover:bg-money-out"
                style={{ height: `${(d.expense / max) * 100}%` }}
              />
            </div>
            <div className="text-[10px] text-ink-faint">
              {formatMonth(d.month)}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs text-ink-faint">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-money-in/80" /> Money in
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-money-out/70" /> Money out
        </span>
      </div>
    </div>
  );
}

function formatMonth(m: string): string {
  const [, mm] = m.split("-");
  const names = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return names[Number(mm)] ?? m;
}
