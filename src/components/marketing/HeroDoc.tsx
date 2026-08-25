/**
 * The hero artefact: a VAT return, set the way the app sets it.
 *
 * Deliberately the product's own output rather than a device mockup or an
 * abstract illustration. Anyone doing Irish VAT recognises T1/T2 immediately,
 * and the figures below genuinely add up — 3,286.24 less 1,180.48 is 2,105.76 —
 * because a marketing page for an accounting tool that cannot add is its own
 * argument against buying it.
 */
export function HeroDoc() {
  const salesRows = [
    { label: "Sales at 23%", net: "14,288.00", vat: "3,286.24" },
    { label: "Zero-rated exports", net: "27,000.00", vat: "0.00" },
  ];
  const purchaseRows = [
    { label: "Purchases at 23%", net: "5,132.52", vat: "1,180.48" },
  ];

  return (
    <div className="mk-doc rounded-xl p-6 sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-faint)]">
            VAT 3 · cash basis
          </div>
          <div className="mk-display mt-1 text-lg">Jan – Jun 2026</div>
        </div>
        <div className="rounded-full bg-[color:var(--brand)]/10 px-2.5 py-1 text-[11px] font-medium text-[color:var(--brand-dark)]">
          reconciled
        </div>
      </div>

      <div className="mt-5 grid grid-cols-[1fr_auto_auto] gap-x-4 text-[13px]">
        <div className="col-span-3 mb-1 grid grid-cols-subgrid text-[10px] uppercase tracking-[0.14em] text-[color:var(--ink-faint)]">
          <span />
          <span className="text-right">Net</span>
          <span className="text-right">VAT</span>
        </div>

        {salesRows.map((r) => (
          <div key={r.label} className="mk-doc-row col-span-3 grid grid-cols-subgrid">
            <span className="text-[color:var(--ink-soft)]">{r.label}</span>
            <span className="mk-figure text-right">{r.net}</span>
            <span className="mk-figure text-right">{r.vat}</span>
          </div>
        ))}
        <div className="mk-doc-row mk-doc-total col-span-3 grid grid-cols-subgrid">
          <span>T1 · VAT on sales</span>
          <span className="mk-figure text-right text-[color:var(--ink-faint)]">41,288.00</span>
          <span className="mk-figure text-right">3,286.24</span>
        </div>

        <div className="col-span-3 h-5" />

        {purchaseRows.map((r) => (
          <div key={r.label} className="mk-doc-row col-span-3 grid grid-cols-subgrid">
            <span className="text-[color:var(--ink-soft)]">{r.label}</span>
            <span className="mk-figure text-right">{r.net}</span>
            <span className="mk-figure text-right">{r.vat}</span>
          </div>
        ))}
        <div className="mk-doc-row mk-doc-total col-span-3 grid grid-cols-subgrid">
          <span>T2 · VAT on purchases</span>
          <span className="mk-figure text-right text-[color:var(--ink-faint)]">5,132.52</span>
          <span className="mk-figure text-right">1,180.48</span>
        </div>
      </div>

      <div className="mt-6 flex items-baseline justify-between border-t-2 border-[color:var(--ink)] pt-3">
        <span className="mk-display text-base">Payable</span>
        <span className="mk-figure mk-figure-lg text-2xl font-semibold">€2,105.76</span>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-[color:var(--ink-faint)]">
        Output VAT recognised when each customer paid, apportioned across
        part-payments. Two expenses in this period still have no rate set —
        cashish says so rather than leaving them out quietly.
      </p>
    </div>
  );
}
