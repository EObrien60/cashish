/**
 * What a matched transaction IS, rather than how it is labelled.
 *
 * A rule used to carry only dimensions — category, VAT, vendor, employee — so
 * every consumer had to re-derive the intent from them. That is why a rule could
 * name a supplier in its match text, categorise the spend perfectly, and still
 * leave the vendor list unable to say who was paid: nothing in the model said
 * "this is a payment to a supplier".
 *
 * The kind now says it, and the kind decides which reference is REQUIRED. An
 * unattributed supplier rule cannot be saved, which is a better guarantee than
 * an audit that has to be remembered.
 *
 * Deliberately NOT a posting engine. Applying rules still only sets fields; it
 * creates no payments. "Apply rules" is a button people press repeatedly, and a
 * side-effecting apply needs idempotency keys to avoid double-posting. Intent
 * feeds the existing reconcile and bill-matching steps as proposals; those stay
 * reviewable, because matching is ambiguous exactly when a client pays five
 * identical invoices.
 */

export const POSTINGS = [
  "sales_receipt",
  "vendor_payment",
  "payroll",
  "tax",
  "transfer",
  "other",
] as const;
export type Posting = (typeof POSTINGS)[number];

export const TAX_KINDS = ["vat", "paye", "ct", "other"] as const;
export type TaxKind = (typeof TAX_KINDS)[number];

export type PostingSpec = {
  id: Posting;
  label: string;
  blurb: string;
  /** The reference the kind cannot do without. */
  requires: "customer" | "vendor" | "employee" | "taxKind" | null;
  /** The direction the kind implies, when it implies one. */
  direction: "in" | "out" | null;
  /** Whether the kind takes the transaction out of the books. */
  excludes: boolean;
  /** Which category kind is sensible; null means either. */
  categoryKind: "income" | "expense" | null;
};

export const POSTING_SPECS: Record<Posting, PostingSpec> = {
  sales_receipt: {
    id: "sales_receipt",
    label: "Money in from a customer",
    blurb:
      "Revenue. Feeds reconciliation, which proposes the open invoice this settles — " +
      "it is not matched automatically, because a client paying several identical " +
      "invoices is exactly when a guess goes wrong.",
    requires: "customer",
    direction: "in",
    excludes: false,
    categoryKind: "income",
  },
  vendor_payment: {
    id: "vendor_payment",
    label: "Payment to a supplier",
    blurb:
      "Cost. Feeds bill matching, which proposes the open bill this pays. The " +
      "vendor is required, so supplier spend can always be attributed.",
    requires: "vendor",
    direction: "out",
    excludes: false,
    categoryKind: "expense",
  },
  payroll: {
    id: "payroll",
    label: "Payment to a person",
    blurb:
      "Wages, a contractor, or a director. Attributes the payment to that person " +
      "without needing an RPN import or a pay run.",
    requires: "employee",
    direction: "out",
    excludes: false,
    categoryKind: "expense",
  },
  tax: {
    id: "tax",
    label: "Tax paid or refunded",
    blurb:
      "Revenue, in either direction. Says which tax it is so the VAT return and " +
      "payroll figures can tell them apart.",
    requires: "taxKind",
    direction: null,
    excludes: false,
    categoryKind: null,
  },
  transfer: {
    id: "transfer",
    label: "Internal transfer",
    blurb:
      "Your own money moving between your own accounts or pots, or a currency " +
      "exchange. Counted nowhere, while the row stays so a statement still " +
      "reconciles line for line.",
    requires: null,
    direction: null,
    excludes: true,
    categoryKind: null,
  },
  other: {
    id: "other",
    label: "Just categorise it",
    blurb:
      "Label it and nothing more. The right answer for one-off spend that needs " +
      "no counterparty, and the fallback when none of the above fits.",
    requires: null,
    direction: null,
    excludes: false,
    categoryKind: null,
  },
};

export const isPosting = (v: unknown): v is Posting =>
  typeof v === "string" && (POSTINGS as readonly string[]).includes(v);

export const isTaxKind = (v: unknown): v is TaxKind =>
  typeof v === "string" && (TAX_KINDS as readonly string[]).includes(v);

export type PostingDraft = {
  posting: Posting;
  customerId?: string | null;
  vendorId?: string | null;
  employeeId?: string | null;
  taxKind?: string | null;
  categoryId?: string | null;
  direction?: string;
};

/**
 * Validates a rule against its posting kind.
 *
 * Returns a message rather than throwing: this runs behind a form, and the
 * person typing needs to be told which field is missing.
 */
export function validatePosting(draft: PostingDraft): string | null {
  if (!isPosting(draft.posting)) return "Choose what kind of transaction this is.";
  const spec = POSTING_SPECS[draft.posting];

  switch (spec.requires) {
    case "customer":
      if (!draft.customerId) return "Money in from a customer needs the customer named.";
      break;
    case "vendor":
      if (!draft.vendorId) return "A payment to a supplier needs the vendor named.";
      break;
    case "employee":
      if (!draft.employeeId) return "A payment to a person needs that person named.";
      break;
    case "taxKind":
      if (!isTaxKind(draft.taxKind)) return "Say which tax this is.";
      break;
    default:
      break;
  }

  // A kind that implies a direction must not contradict it: "money in from a
  // customer" applied to money out is not a rule anyone meant to write.
  if (spec.direction && draft.direction && draft.direction !== "any") {
    if (draft.direction !== spec.direction) {
      return `${spec.label} can only apply to money ${spec.direction === "in" ? "in" : "out"}.`;
    }
  }

  // References that belong to a different kind are dropped rather than rejected
  // (see normalisePosting), so no error here.
  return null;
}

/**
 * Puts a rule into the shape its kind implies — without destroying anything.
 *
 * It fixes the direction where the kind implies one, and clears the category for
 * a transfer, which is counted nowhere.
 *
 * It deliberately does NOT strip references the kind does not require. An
 * earlier version did, and it was wrong twice over: every existing rule carrying
 * a vendor or an employee without a declared kind silently lost it, and a tax
 * rule would have stripped the vendor from Revenue Commissioners — which is
 * legitimately both a tax and a payee you want spend attributed to. Validation
 * guarantees the REQUIRED reference is present; an extra one is more information,
 * not a contradiction, and silently deleting a reference is worse than allowing
 * an odd-looking combination.
 */
export function normalisePosting<T extends PostingDraft>(draft: T): T {
  const spec = POSTING_SPECS[draft.posting];
  const out = { ...draft };
  if (spec.direction) out.direction = spec.direction;
  if (spec.excludes) out.categoryId = null;
  return out;
}

/** A one-line summary of what a rule will do, for the rules list. */
export function describePosting(
  posting: string,
  names: { customer?: string | null; vendor?: string | null; employee?: string | null; taxKind?: string | null },
): string {
  if (!isPosting(posting)) return "Categorise";
  switch (posting) {
    case "sales_receipt":
      return `Money in from ${names.customer ?? "a customer"}`;
    case "vendor_payment":
      return `Paid to ${names.vendor ?? "a supplier"}`;
    case "payroll":
      return `Paid to ${names.employee ?? "a person"}`;
    case "tax":
      return `Tax · ${(names.taxKind ?? "other").toUpperCase()}`;
    case "transfer":
      return "Internal transfer — counted nowhere";
    default:
      return "Categorise only";
  }
}
