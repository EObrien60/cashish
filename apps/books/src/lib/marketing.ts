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
    code: "personal",
    pitch: "Your own money, on the same ledger the businesses run on.",
    includes: [
      "Every account in one place — current, credit card, savings",
      "A budget per category, against what you actually spent",
      "Transfers between your own accounts are not counted as spending",
      "Where it went, month by month, without a spreadsheet",
      "Statements from any bank that exports a CSV",
    ],
  },
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

/**
 * Who a feature is for.
 *
 * Tagged rather than duplicated into two lists, because most of cashish is the
 * same product either way — the ledger does not care whose money it is. Only
 * the trading half (invoices, VAT, payroll) and the budgeting half are actually
 * exclusive, and saying so honestly is more persuasive than implying that a
 * personal book is a second product.
 */
export type Audience = "both" | "business" | "personal";

export const FEATURES: {
  kicker: string;
  title: string;
  body: string;
  for: Audience;
}[] = [
  {
    for: "both",
    kicker: "Import",
    title: "Your statement, understood",
    body:
      "Upload the CSV your bank already gives you. Re-uploading an overlapping " +
      "period is safe — rows are keyed on the bank's own transaction id, so " +
      "nothing doubles up and nothing you have already categorised is touched.",
  },
  {
    for: "both",
    kicker: "Rules",
    title: "Correct a rule, fix the history",
    body:
      "Write a rule once and it applies to everything it matches, including the " +
      "transactions it previously got wrong. Test it first and see exactly what " +
      "it would catch before you save it. Anything you categorised by hand that " +
      "no rule has an opinion about is left alone.",
  },
  {
    for: "business",
    kicker: "Reconcile",
    title: "Which invoice did that money pay?",
    body:
      "Bank inflows are matched to the invoices that explain them — one payment " +
      "to one invoice, even when a client pays five identical monthly amounts. " +
      "Money that arrived before an invoice existed is never offered as its payment.",
  },
  {
    for: "business",
    kicker: "VAT",
    title: "Cash basis, the Irish way",
    body:
      "Output VAT recognised when the customer actually pays, apportioned across " +
      "part-payments and mixed-rate invoices. T1, T2 and the balance, with the " +
      "expenses that are still missing a rate called out rather than quietly omitted.",
  },
  {
    for: "both",
    kicker: "Exclude",
    title: "A transfer is not an expense",
    body:
      "Moving money into your own tax pot is not money spent. Exclude it and it " +
      "is counted nowhere — not in reports, not in VAT, not in what you tell " +
      "anyone else — while the row stays put so a statement still reconciles " +
      "line for line.",
  },
  {
    for: "both",
    kicker: "Agents",
    title: "Built to be driven by an AI",
    body:
      "cashish is an MCP server as well as an app. Point Claude at it and it can " +
      "read the ledger, write rules, raise invoices and match payments — using " +
      "exactly the same code the screens use. A read-only key stays read-only.",
  },
  {
    for: "both",
    kicker: "Accounts",
    title: "Current, credit card, savings — all of it",
    body:
      "Every account you import sits side by side with its own balance and its own " +
      "history. Money moved between two of them is recognised as a transfer and " +
      "counted as spending in neither, which is the difference between a number " +
      "you can trust and one that double-counts every time you top up savings.",
  },
  {
    for: "personal",
    kicker: "Budget",
    title: "An envelope per category",
    body:
      "Set what you mean to spend on groceries, fuel or eating out and see it against " +
      "what actually left the account. No forecast, no projection — last month is a " +
      "fact, and a budget you can check against one is worth more than one you cannot.",
  },
  {
    for: "personal",
    kicker: "Savings",
    title: "Watch the balance go the right way",
    body:
      "A savings account gets its own view: what went in, what came out, and the " +
      "balance over time. Where the return is genuinely knowable it is shown, and " +
      "where it is not — because a statement records deposits and not interest — it " +
      "says so instead of inventing a percentage.",
  },
  {
    for: "both",
    kicker: "Documents",
    title: "Point it at a folder of paperwork",
    body:
      "Invoices, receipts and payslips are read into fields — issuer, date, net, VAT, " +
      "total. Nothing reaches the books until you confirm it, every field is editable " +
      "first, and what gets saved is what is on screen rather than what was read.",
  },
  {
    for: "both",
    kicker: "Both at once",
    title: "Your business and your household, one login",
    body:
      "Books are separate: separate ledger, separate categories, separate everything. " +
      "Switch between them from the sidebar. Nothing from one appears in a report, a " +
      "VAT return or a budget belonging to the other.",
  },
];

/**
 * The two stories the hero tells, and the switch between them.
 *
 * Same product, same ledger — but a person deciding whether this is for them
 * has one of two jobs in mind, and a hero that hedges across both persuades
 * neither. So the page picks one and offers the other explicitly.
 */
export const AUDIENCES = {
  business: {
    label: "For a business",
    kicker: "Irish · EUR · cash-basis VAT",
    headline: ["The books,", "actually sorted"],
    body:
      "Upload the statement your bank already gives you. cashish categorises it, " +
      "matches the money to your invoices, and works out the VAT — on the cash " +
      "basis, the way a small Irish company actually files.",
    cta: "Start a set of books",
    figures: [
      ["220", "bank lines in a first import"],
      ["63", "rules doing the categorising"],
      ["1", "place the VAT figure comes from"],
      ["0", "spreadsheets involved"],
    ],
  },
  personal: {
    label: "For yourself",
    kicker: "Current · Credit card · Savings",
    headline: ["Your own money,", "finally legible"],
    body:
      "The same ledger, with the trading half switched off. Import every account " +
      "you have, let the rules do the categorising, and see where it actually went " +
      "— with a budget per category and transfers between your own accounts " +
      "counted as spending in neither.",
    cta: "Start a personal book",
    figures: [
      ["12k", "transactions is a normal ledger"],
      ["3", "kinds of account: current, credit, savings"],
      ["0", "of your transfers counted as spending"],
      ["1", "login for your business and your household"],
    ],
  },
} as const;

export type AudienceKey = keyof typeof AUDIENCES;

export const FAQ = [
  {
    q: "Can I keep my business and my personal books in the same account?",
    a:
      "Yes, and they stay completely separate — separate ledger, separate categories, " +
      "separate reports. You switch between them in the sidebar. A personal book has no " +
      "invoices, no VAT return and no payroll; it has a budget instead.",
  },
  {
    q: "What does a personal book actually give me?",
    a:
      "Every account in one place with its own balance, rules that categorise the " +
      "spending, a budget per category against what you really spent, and a month-by-" +
      "month view of where it went. Money moved between your own accounts is recognised " +
      "as a transfer, so topping up savings never reads as €500 of spending.",
  },
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
      "Any bank that exports a CSV. It was built against Revolut — the business export " +
      "and the personal one, including savings statements, which are a different shape " +
      "again — and reads a handful of common header spellings, so most exports import " +
      "without fuss. There is no bank feed: you upload the file.",
  },
  {
    q: "Is it only euro?",
    a:
      "Yes, deliberately. EUR-only keeps the VAT logic honest. Foreign-currency " +
      "transactions still import with their original amount recorded.",
  },
  {
    q: "Does it tell me what to do with my money?",
    a:
      "No. cashish is a ledger, not an adviser: it shows you what happened and what you " +
      "budgeted, and every figure traces back to a bank line you can click. It does not " +
      "recommend investments and it does not project your future.",
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
