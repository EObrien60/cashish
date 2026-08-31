/**
 * Everything the public site says about the product, in one place.
 *
 * ── WHAT IS TRUE HERE, AND WHAT LIVES IN THE DATABASE ───────────────────────
 * The PROSE is here. The NUMBERS — price, cadence, seat limit, which features a
 * plan includes — come from the `plans` table, which is also what the limits in
 * src/lib/limits.ts enforce. They are read together in the pricing page so that
 * the site cannot advertise a limit that is not applied, or a price nobody set.
 *
 * A plan covers ONE SET OF BOOKS. Subscriptions are per tenant, so the thing
 * that separates the plans is how many people may work in one business and what
 * that business can do — never how many businesses you may own. Add a second
 * business and it is a second subscription.
 *
 * `BILLING_LIVE` is still false: no card is taken anywhere, every gate in
 * limits.ts is a no-op, and the pricing page says so plainly rather than
 * implying a charge that cannot happen. Flip it once the prices are real.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const BILLING_LIVE = false;

/** The prose for a plan. Its price and limits come from the `plans` table. */
export type PlanCopy = {
  code: string;
  pitch: string;
  best?: boolean;
  includes: string[];
};

export const PLAN_COPY: PlanCopy[] = [
  {
    code: "sole",
    pitch: "One business, one person, books that stay straight.",
    includes: [
      "Unlimited bank statement imports",
      "Categorisation rules that apply retroactively",
      "Invoices, recurring invoices and payment matching",
      "Cash or invoice basis VAT return figures",
      "P&L, cashflow and margin reporting",
    ],
  },
  {
    code: "company",
    pitch: "For a limited company with an accountant and a few people to pay.",
    best: true,
    includes: [
      "Everything in Sole trader",
      "Invite your accountant with their own login and role",
      "People and payroll — Irish PAYE, RPN import, payslips",
      "Receipt attachments",
      "MCP access, so an AI agent can do the bookkeeping",
    ],
  },
  {
    code: "practice",
    pitch: "You keep books for other people and want them all in one place.",
    includes: [
      "Everything in Company",
      "OAuth connections for agent tooling",
      "Volume pricing across the businesses you run",
      "Priority on the things you need next",
    ],
  },
];

/** How a seat limit reads on the pricing card. */
export function seatLine(maxUsers: number | null): string {
  if (maxUsers === null) return "Unlimited people in this business.";
  return maxUsers === 1
    ? "One person in this business."
    : `Up to ${maxUsers} people in this business.`;
}

export const FEATURES = [
  {
    kicker: "Import",
    title: "Your statement, understood",
    body:
      "Upload the CSV your bank already gives you. Re-uploading an overlapping " +
      "period is safe — rows are keyed on the bank's own transaction id, so " +
      "nothing doubles up and nothing you have already categorised is touched.",
  },
  {
    kicker: "Rules",
    title: "Correct a rule, fix the history",
    body:
      "Write a rule once and it applies to everything it matches, including the " +
      "transactions it previously got wrong. Test it first and see exactly what " +
      "it would catch before you save it. Anything you categorised by hand that " +
      "no rule has an opinion about is left alone.",
  },
  {
    kicker: "Reconcile",
    title: "Which invoice did that money pay?",
    body:
      "Bank inflows are matched to the invoices that explain them — one payment " +
      "to one invoice, even when a client pays five identical monthly amounts. " +
      "Money that arrived before an invoice existed is never offered as its payment.",
  },
  {
    kicker: "VAT",
    title: "Cash basis, the Irish way",
    body:
      "Output VAT recognised when the customer actually pays, apportioned across " +
      "part-payments and mixed-rate invoices. T1, T2 and the balance, with the " +
      "expenses that are still missing a rate called out rather than quietly omitted.",
  },
  {
    kicker: "Exclude",
    title: "A transfer is not an expense",
    body:
      "Moving money into your own tax pot is not money spent. Exclude it and it " +
      "is counted nowhere — not in reports, not in VAT, not in what you tell " +
      "anyone else — while the row stays put so a statement still reconciles " +
      "line for line.",
  },
  {
    kicker: "Agents",
    title: "Built to be driven by an AI",
    body:
      "cashish is an MCP server as well as an app. Point Claude at it and it can " +
      "read the ledger, write rules, raise invoices and match payments — using " +
      "exactly the same code the screens use. A read-only key stays read-only.",
  },
];

export const FAQ = [
  {
    q: "Is this a Revenue-approved filing tool?",
    a:
      "No. cashish works out the figures — your VAT3 boxes, your P&L, a PSR-shaped " +
      "payroll submission — and you file them. Check them against ROS before you " +
      "submit anything.",
  },
  {
    q: "Which banks work?",
    a:
      "Any bank that exports a CSV. It was built against Revolut Business and reads " +
      "a handful of common header spellings, so most exports import without fuss.",
  },
  {
    q: "Is it only euro?",
    a:
      "Yes, deliberately. EUR-only keeps the VAT logic honest. Foreign-currency " +
      "transactions still import with their original amount recorded.",
  },
  {
    q: "Can my accountant get in?",
    a:
      "Invite them from Settings. They get their own login and the accountant role: " +
      "they can work the books but cannot change your business settings, your people, " +
      "or your API keys.",
  },
  {
    q: "Where does my data live?",
    a: "Postgres in Frankfurt, inside the EU. Receipt files are stored privately, not on a public URL.",
  },
  {
    q: "Can I get my data back out?",
    a:
      "Yes. Every screen is backed by an API key you control, and there is a JSON " +
      "export of the whole picture. It is your ledger.",
  },
];
