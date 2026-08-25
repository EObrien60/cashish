/**
 * Everything the public site says about the product, in one place.
 *
 * ── PRICES ARE PLACEHOLDERS ─────────────────────────────────────────────────
 * Nobody has decided them, and no card is taken anywhere: there is no payment
 * integration in this codebase. `BILLING_LIVE` is false, which makes the pricing
 * page say so plainly rather than implying a charge that cannot happen. Set the
 * numbers you actually want here, and flip the flag once billing exists.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const BILLING_LIVE = false;

export type Plan = {
  id: string;
  name: string;
  price: number | null;
  cadence: string;
  pitch: string;
  best?: boolean;
  includes: string[];
  limits?: string;
};

export const PLANS: Plan[] = [
  {
    id: "sole",
    name: "Sole trader",
    price: 9,
    cadence: "per month",
    pitch: "One business, one person, books that stay straight.",
    includes: [
      "Unlimited bank statement imports",
      "Categorisation rules that apply retroactively",
      "Invoices, recurring invoices and payment matching",
      "Cash or invoice basis VAT return figures",
      "Read-only API key for your own scripts",
    ],
    limits: "One business. One user.",
  },
  {
    id: "company",
    name: "Company",
    price: 29,
    cadence: "per month",
    best: true,
    pitch: "For a limited company with an accountant and a few people to pay.",
    includes: [
      "Everything in Sole trader",
      "Up to five businesses, switched from the sidebar",
      "Invite your accountant with their own login and role",
      "People and payroll — attach payments without RPN filing",
      "Receipt attachments",
      "MCP access, so an AI agent can do the bookkeeping",
    ],
    limits: "Five businesses. Unlimited users.",
  },
  {
    id: "practice",
    name: "Practice",
    price: null,
    cadence: "talk to us",
    pitch: "You keep books for other people and want them all in one place.",
    includes: [
      "Everything in Company",
      "Unlimited businesses",
      "OAuth connections for agent tooling",
      "Priority on the things you need next",
    ],
  },
];

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
