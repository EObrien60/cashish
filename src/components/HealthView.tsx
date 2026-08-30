import Link from "next/link";
import { CHASE_FLOOR, type Health } from "@/lib/health";
import { money, moneySigned, fmtDate } from "@/lib/format";
import { Card } from "./ui";
import { Delta, ShareBar } from "./ReportBits";
import { IconChevron } from "./icons";

/*
 * The health dashboard.
 *
 * Ordered by urgency rather than by tidiness: can the business pay its way, is
 * anything owed to it going bad, which way is it heading, how exposed is it, and
 * what should be done today. Reports answer what happened in a period; nothing
 * here is period-scoped, because none of these questions are.
 */

const Section = ({
  title,
  aside,
  children,
  className = "",
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) => (
  <Card className={`p-5 ${className}`}>
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="font-semibold text-ink">{title}</h2>
      {aside && <div className="text-xs text-ink-faint">{aside}</div>}
    </div>
    {children}
  </Card>
);

/**
 * The verdict.
 *
 * One sentence an owner can act on, derived rather than decorative. Runway leads
 * when the business is spending more than it earns, because that is the number with
 * a deadline attached; otherwise the monthly surplus leads. Free cash overrides both
 * when it is negative — cash that is already spoken for is not cash.
 */
function Verdict({ health }: { health: Health }) {
  const { runway: r, committed: c } = health;
  const short = c.free !== null && c.free < 0;
  const tight = r.burning && r.months !== null && r.months < 3;

  const tone = short || tight
    ? { ring: "ring-money-out/25", wash: "bg-money-out/[0.06]", ink: "text-money-out", label: "Needs attention" }
    : r.burning
      ? { ring: "ring-amber-400/30", wash: "bg-amber-50", ink: "text-amber-700", label: "Watch the burn" }
      : { ring: "ring-brand/25", wash: "bg-brand-wash", ink: "text-brand-dark", label: "Healthy" };

  const headline =
    r.cash === null
      ? "No bank balance yet"
      : r.burning
        ? r.months === null || r.months === 0
          ? "Out of runway"
          : r.comfortable
            ? "Over 2 years of runway"
            : `${r.months} month${r.months === 1 ? "" : "s"} of runway`
        : `${money(r.monthlyNet)} a month ahead`;

  const explain =
    r.cash === null
      ? "Import a statement and this fills in — the balance is what everything here is measured against."
      : r.burning
        ? `Spending ${money(Math.abs(r.monthlyNet))} more than comes in each month, against ${money(r.cash)} in the bank.`
        : `Earning ${money(r.monthlyNet)} more than goes out each month, on ${money(r.cash)} in the bank.`;

  return (
    <Card className={`p-6 ring-1 ${tone.ring} ${tone.wash}`}>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <div className={`text-xs font-semibold uppercase tracking-wide ${tone.ink}`}>
            {tone.label}
          </div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            {headline}
          </div>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-soft">{explain}</p>
          {short && (
            <p className="mt-2 max-w-xl text-sm font-medium text-money-out">
              {money(Math.abs(c.free!))} short of the next month&rsquo;s commitments.
            </p>
          )}
        </div>
        <div className="grid w-full min-w-0 grid-cols-2 gap-x-8 gap-y-3 sm:w-auto sm:shrink-0 sm:grid-cols-1">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              In the bank
            </div>
            <div className="mt-0.5 text-2xl font-bold tabular text-ink">
              {r.cash === null ? "—" : money(r.cash)}
            </div>
            {r.cashAsOf && (
              <div className="text-xs text-ink-faint">as of {fmtDate(r.cashAsOf)}</div>
            )}
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Free after commitments
            </div>
            <div
              className={`mt-0.5 text-2xl font-bold tabular ${
                c.free === null ? "text-ink" : c.free < 0 ? "text-money-out" : "text-money-in"
              }`}
            >
              {c.free === null ? "—" : moneySigned(c.free)}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

const COMMIT_COLOUR: Record<string, string> = {
  vat: "#c0492f",
  payroll: "#0f7b5f",
  tax: "#b45309",
  vendor: "#1aa37c",
};

/** Cash on hand against what the next month already claims. */
function Committed({ health }: { health: Health }) {
  const { committed: c, runway: r } = health;
  if (!c.items.length) {
    return (
      <Section title="Committed cash" aside="next month">
        <p className="text-sm text-ink-faint">
          Nothing recurring found yet. Once wages, tax and supplier payments have a few
          months of history behind them, what the next month owes shows here.
        </p>
      </Section>
    );
  }
  const scale = Math.max(c.total, r.cash ?? 0) || 1;

  return (
    <Section title="Committed cash" aside="next month">
      {/* Cash and commitments on one scale, so the shortfall is visible rather than arithmetic. */}
      <div className="space-y-3">
        <div>
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="font-medium text-ink-soft">In the bank</span>
            <span className="tabular text-ink-faint">{r.cash === null ? "—" : money(r.cash)}</span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-black/[0.06]">
            <div
              className="h-full rounded-full bg-ink/70"
              style={{ width: `${Math.min(100, ((r.cash ?? 0) / scale) * 100)}%` }}
            />
          </div>
        </div>
        <div>
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="font-medium text-ink-soft">Committed</span>
            <span className="tabular text-ink-faint">{money(c.total)}</span>
          </div>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-black/[0.06]">
            {c.items.map((item) => (
              <div
                key={item.label}
                title={`${item.label}: ${money(item.amount)}`}
                style={{
                  width: `${(item.amount / scale) * 100}%`,
                  background: COMMIT_COLOUR[item.kind] ?? "#6b7d76",
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <ul className="mt-4 space-y-2.5">
        {c.items.map((item) => (
          <li key={item.label} className="flex items-baseline gap-2.5 text-sm">
            <span
              className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
              style={{ background: COMMIT_COLOUR[item.kind] ?? "#6b7d76" }}
            />
            <span className="min-w-0 flex-1">
              <span className="text-ink">{item.label}</span>
              <span className="block text-xs text-ink-faint">{item.detail}</span>
            </span>
            <span className="tabular font-medium text-ink">{money(item.amount)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-ink-faint">
        VAT is the computed figure for the current return. The rest are averages of what
        actually left the account over the last three months, which is a better guide to
        next month than a schedule nobody has filled in.
      </p>
    </Section>
  );
}

const AGING_COLOUR = ["#0f7b5f", "#b45309", "#d97706", "#c0492f"];

/** Who owes what, how late, and how long they normally take. */
function Receivables({ health }: { health: Health }) {
  const ar = health.receivables;
  return (
    <Section
      title="Owed to you"
      aside={ar.dso === null ? "no paid invoices yet" : `paid in ${ar.dso} days on average`}
    >
      {ar.total < CHASE_FLOOR ? (
        /*
         * Nothing worth chasing. A rounding remainder is still a debt and stays in the
         * total, but a full-width red aging bar over nine cent reads as a crisis, and a
         * card that cries wolf is worse than one that says nothing.
         */
        <p className="text-sm text-ink-faint">
          Nothing meaningful outstanding — every invoice raised has been settled
          {ar.count > 0 && `, bar ${money(ar.total)} of rounding on ${ar.count} of them`}.
        </p>
      ) : (
        <>
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-bold tabular text-ink">{money(ar.total)}</span>
            <span className="text-xs text-ink-faint">
              across {ar.count} invoice{ar.count === 1 ? "" : "s"}
              {ar.overdue > 0 && (
                <>
                  {" · "}
                  <span className="font-medium text-money-out">{money(ar.overdue)} overdue</span>
                </>
              )}
            </span>
          </div>

          <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-black/[0.06]">
            {ar.buckets.map((b, i) =>
              b.amount <= 0 ? null : (
                <div
                  key={b.label}
                  title={`${b.label}: ${money(b.amount)}`}
                  style={{ width: `${(b.amount / ar.total) * 100}%`, background: AGING_COLOUR[i] }}
                />
              ),
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ar.buckets.map((b, i) => (
              <div key={b.label}>
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: AGING_COLOUR[i], opacity: b.amount > 0 ? 1 : 0.25 }}
                  />
                  <span className="text-xs text-ink-faint">{b.label}</span>
                </div>
                <div
                  className={`mt-0.5 text-sm font-medium tabular ${
                    b.amount > 0 ? "text-ink" : "text-ink-faint"
                  }`}
                >
                  {money(b.amount)}
                </div>
              </div>
            ))}
          </div>

          {ar.worst.length > 0 && (
            <div className="mt-5 border-t border-line pt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Worth a phone call
              </div>
              <ul className="space-y-2">
                {ar.worst.map((d) => (
                  <li key={d.number} className="flex items-baseline gap-2 text-sm">
                    <Link
                      href={`/customers/${d.customerId}`}
                      className="min-w-0 flex-1 truncate hover:underline"
                    >
                      {d.customerName}
                      <span className="text-ink-faint"> · {d.number}</span>
                    </Link>
                    <span className="shrink-0 text-xs text-money-out">{d.daysOverdue}d late</span>
                    <span className="w-24 shrink-0 text-right tabular font-medium">
                      {money(d.outstanding)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

/** Twelve months of net, and whether the last three beat the three before. */
function Direction({ health }: { health: Health }) {
  const d = health.direction;
  const peak = Math.max(1, ...d.months.map((m) => Math.abs(m.net)));

  return (
    <Section title="Which way it is going" aside="last 12 months">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <div className="text-xs text-ink-faint">Revenue</div>
          <div className="text-lg font-bold tabular text-ink">{money(d.revenue.now)}</div>
          <Delta value={d.revenue.change} />
        </div>
        <div>
          <div className="text-xs text-ink-faint">Spending</div>
          <div className="text-lg font-bold tabular text-ink">{money(d.expenses.now)}</div>
          <Delta value={d.expenses.change} goodWhenUp={false} />
        </div>
        <div>
          <div className="text-xs text-ink-faint">Net</div>
          <div
            className={`text-lg font-bold tabular ${
              d.net.now >= 0 ? "text-money-in" : "text-money-out"
            }`}
          >
            {moneySigned(d.net.now)}
          </div>
          <span className="text-xs text-ink-faint">
            was {moneySigned(d.net.prior)}
          </span>
        </div>
      </div>

      {/* Net per month, drawn from a centre line so a losing month reads as a loss. */}
      <div className="mt-5 flex h-28 items-center gap-1">
        {d.months.map((m) => {
          const h = (Math.abs(m.net) / peak) * 50;
          const up = m.net >= 0;
          return (
            <div
              key={m.month}
              className="group relative flex h-full flex-1 flex-col justify-center"
              title={`${m.month}: ${moneySigned(m.net)}`}
            >
              <div className="flex h-1/2 items-end">
                {up && (
                  <div
                    className="w-full rounded-t bg-money-in/75"
                    style={{ height: `${Math.max(m.net === 0 ? 0 : 2, h * 2)}%` }}
                  />
                )}
              </div>
              <div className="h-px w-full bg-line" />
              <div className="flex h-1/2 items-start">
                {!up && (
                  <div
                    className="w-full rounded-b bg-money-out/75"
                    style={{ height: `${Math.max(2, h * 2)}%` }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-faint">
        <span>{d.months[0]?.month}</span>
        <span>{d.months[d.months.length - 1]?.month}</span>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-ink-faint">
        The comparison is the last three months against the three before them — equal
        lengths, so it holds without knowing your financial year.
      </p>
    </Section>
  );
}

/** How much of the money in depends on too few customers. */
function Concentration({ health }: { health: Health }) {
  const c = health.concentration;
  if (c.total <= 0) {
    return (
      <Section title="Where revenue depends" aside="last 12 months">
        <p className="text-sm text-ink-faint">
          No money in is attributed to a customer yet, so there is nothing to weigh. Rules
          that post receipts to a customer fill this in.
        </p>
      </Section>
    );
  }
  const risky = !c.thin && c.topShare >= 40;
  const max = c.lines[0]?.amount ?? 1;

  return (
    <Section title="Where revenue depends" aside="last 12 months">
      <div className="flex items-baseline gap-3">
        <span
          className={`text-2xl font-bold tabular ${risky ? "text-money-out" : "text-ink"}`}
        >
          {c.topShare}%
        </span>
        <span className="text-xs text-ink-faint">
          from one customer · {c.top3Share}% from the top three
        </span>
      </div>

      <ul className="mt-4 space-y-3">
        {c.lines.map((l) => (
          <li key={l.customerId}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <Link href={`/customers/${l.customerId}`} className="min-w-0 truncate hover:underline">
                {l.name}
              </Link>
              <span className="shrink-0 tabular text-ink-faint">
                {l.share}% · {money(l.amount)}
              </span>
            </div>
            <ShareBar value={l.amount} max={max} color={risky && l === c.lines[0] ? "#c0492f" : "#0f7b5f"} />
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs leading-relaxed text-ink-faint">
        {c.thin
          ? "Only one customer has paid in this window, so the share is arithmetic rather than a finding."
          : risky
            ? `Losing ${c.lines[0]?.name} would take ${c.topShare}% of the money in with it. Worth knowing before it happens.`
            : "No single customer dominates, which is where you want to be."}
      </p>
    </Section>
  );
}

/** The short list, each line a link to where it gets fixed. */
function Actions({ health }: { health: Health }) {
  if (!health.actions.length) {
    return (
      <Section title="Nothing needs doing">
        <p className="text-sm text-ink-faint">
          Everything is categorised, every receipt is explained and no invoice is overdue.
        </p>
      </Section>
    );
  }
  return (
    <Section title="What needs doing">
      <ul className="divide-y divide-line">
        {health.actions.map((a) => (
          <li key={a.label}>
            <Link
              href={a.href}
              className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-3 hover:bg-black/[0.02]"
            >
              <span
                className={`flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-bold tabular ${
                  a.tone === "warn"
                    ? "bg-money-out/10 text-money-out"
                    : "bg-black/[0.05] text-ink-soft"
                }`}
              >
                {a.count}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">{a.label}</span>
                <span className="block text-xs text-ink-faint">{a.detail}</span>
              </span>
              <IconChevron className="h-4 w-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5" />
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function HealthView({ health }: { health: Health }) {
  return (
    <div className="space-y-4">
      <Verdict health={health} />
      {/* items-start so a card hugs its content — a half-empty stretched card reads as
          something failing to load. */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Committed health={health} />
        <Receivables health={health} />
      </div>
      <Direction health={health} />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Concentration health={health} />
        <Actions health={health} />
      </div>
    </div>
  );
}
