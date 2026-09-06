/**
 * The personal hero artefact: a month against its budget.
 *
 * The counterpart to HeroDoc, and built to the same rule — the product's own
 * output, with figures that genuinely add up. 1,240 + 402 + 318 + 214 + 96 is
 * 2,270, and the budgets total 2,400, so the €130 under is arithmetic rather
 * than decoration. A landing page for a budgeting tool that cannot add is its
 * own argument against using it.
 *
 * The savings line is the point of the whole thing: €500 moved into savings is
 * not €500 spent, so it sits below the total as a transfer rather than inside
 * it as an envelope.
 */
export function PersonalDoc() {
  const rows = [
    { label: "Rent & mortgage", spent: 1240, budget: 1240 },
    { label: "Groceries", spent: 402, budget: 460 },
    { label: "Transport & fuel", spent: 318, budget: 300 },
    { label: "Eating out", spent: 214, budget: 280 },
    { label: "Subscriptions", spent: 96, budget: 120 },
  ];
  const spent = rows.reduce((a, r) => a + r.spent, 0);
  const budget = rows.reduce((a, r) => a + r.budget, 0);
  const fmt = (n: number) => n.toLocaleString("en-IE", { minimumFractionDigits: 2 });

  return (
    <div className="mk-doc rounded-xl p-6 sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-faint)]">
            Budget · this month
          </div>
          <div className="mk-display mt-1 text-lg">June 2026</div>
        </div>
        <div className="rounded-full bg-[color:var(--brand)]/10 px-2.5 py-1 text-[11px] font-medium text-[color:var(--brand-dark)]">
          €130 under
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {rows.map((r) => {
          const over = r.spent > r.budget;
          // Bars are drawn against the largest budget, not against each row's
          // own, so the lengths are comparable down the column.
          const pct = Math.min(100, (r.spent / 1240) * 100);
          return (
            <div key={r.label}>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-[color:var(--ink-soft)]">{r.label}</span>
                <span className="flex items-baseline gap-2">
                  <span
                    className={`mk-figure ${over ? "text-[color:var(--out)]" : ""}`}
                  >
                    {fmt(r.spent)}
                  </span>
                  <span className="mk-figure text-[11px] text-[color:var(--ink-faint)]">
                    / {fmt(r.budget)}
                  </span>
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--paper-deep)]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    background: over ? "var(--out)" : "var(--brand)",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex items-baseline justify-between border-t-2 border-[color:var(--ink)] pt-3">
        <span className="mk-display text-base">Spent</span>
        <span className="flex items-baseline gap-2">
          <span className="mk-figure text-[11px] text-[color:var(--ink-faint)]">
            of €{fmt(budget)}
          </span>
          <span className="mk-figure mk-figure-lg text-2xl font-semibold">€{fmt(spent)}</span>
        </span>
      </div>

      <div className="mt-3 flex items-baseline justify-between text-[13px]">
        <span className="text-[color:var(--ink-faint)]">
          Moved to savings
          <span className="ml-1.5 text-[10px] uppercase tracking-[0.12em]">not spending</span>
        </span>
        <span className="mk-figure text-[color:var(--ink-faint)]">500.00</span>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-[color:var(--ink-faint)]">
        Transport is €18 over and says so. The €500 into savings is your own money
        moving between your own accounts, so it is counted in neither the spend nor
        the budget.
      </p>
    </div>
  );
}
