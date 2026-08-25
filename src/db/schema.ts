import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  doublePrecision,
  boolean,
  index,
  primaryKey,
  uniqueIndex,
  foreignKey,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Conventions
// - Money is `double precision` in EUR. The app is EUR-only by design.
//   This is a faithful port of the previous SQLite REAL, *not* an endorsement:
//   `numeric(14,2)` is the correct type for money and is tracked as its own
//   follow-up. Changing the representation in the same move as the dialect
//   would make any later cent-level discrepancy unattributable.
// - Bank-out is negative, bank-in is positive (matches the Revolut statement).
// - Timestamps and dates are ISO-8601 *strings* in text columns, deliberately.
//   The query layer compares them lexicographically (`lte(nextRunDate, refISO)`,
//   VAT period ranges, reconciliation windows); `timestamptz`/`date` would
//   silently change those semantics.
// - `id` columns are text UUIDs except bank transactions, which reuse the
//   provider's own transaction id so re-imports dedupe naturally.
// - Every domain table carries `tenant_id`. Scoping is enforced in the query
//   layer (src/db/context.ts + src/lib/*), not by Postgres RLS.
// ---------------------------------------------------------------------------

// Reproduces exactly what SQLite's strftime('%Y-%m-%dT%H:%M:%fZ','now') emitted,
// so every existing consumer of these strings keeps working unchanged.
const now = sql`to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// --- Tenancy + identity -----------------------------------------------------

export const tenants = pgTable(
  "tenants",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("tenant_slug_idx").on(t.slug)],
);

/** Tenant-scoping column, repeated on every domain table. */
const tenantId = () =>
  text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" });

// --- Books ------------------------------------------------------------------

export const settings = pgTable("settings", {
  // One row per tenant; the tenant *is* the key. (Was a single id = 1 row.)
  tenantId: tenantId().primaryKey(),
  businessName: text("business_name").notNull().default("My Business"),
  addressLine1: text("address_line1").default(""),
  addressLine2: text("address_line2").default(""),
  city: text("city").default(""),
  country: text("country").default("Ireland"),
  vatNumber: text("vat_number").default(""),
  email: text("email").default(""),
  phone: text("phone").default(""),
  iban: text("iban").default(""),
  bic: text("bic").default(""),
  invoicePrefix: text("invoice_prefix").notNull().default("INV-"),
  nextInvoiceSeq: integer("next_invoice_seq").notNull().default(1),
  invoiceFooter: text("invoice_footer").default("Thank you for your business."),
  vatBasis: text("vat_basis").notNull().default("cash"), // 'cash' | 'invoice'
  logoDataUrl: text("logo_data_url").default(""),
  employerRegNumber: text("employer_reg_number").default(""), // Employer PAYE/PRSI reg no
});

export const vatRates = pgTable(
  "vat_rates",
  {
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    rate: doublePrecision("rate").notNull(), // 0.23 => 23%
    isDefault: boolean("is_default").notNull().default(false),
    // Irish VAT return box mapping for purchases/sales aggregation.
    exempt: boolean("exempt").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("vat_tenant_idx").on(t.tenantId)],
);

export const categories = pgTable(
  "categories",
  {
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    kind: text("kind").notNull(), // 'income' | 'expense'
    defaultVatRateId: text("default_vat_rate_id").references(() => vatRates.id, {
      onDelete: "set null",
    }),
    // Whether a tx in this category carries claimable/charged VAT at all.
    vatApplicable: boolean("vat_applicable").notNull().default(true),
    color: text("color").default("#9ca3af"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("cat_tenant_idx").on(t.tenantId)],
);

export const transactions = pgTable(
  "transactions",
  {
    // Provider tx id (dedupe key) — unique per provider, but two tenants may
    // legitimately import the same id, so the primary key is composite.
    id: text("id").notNull(),
    tenantId: tenantId(),
    dateStarted: text("date_started"),
    dateCompleted: text("date_completed"),
    bookedDate: text("booked_date").notNull(), // best date for reporting (completed||started)
    type: text("type"),
    state: text("state"),
    description: text("description").default(""),
    reference: text("reference").default(""),
    payer: text("payer").default(""),
    cardLabel: text("card_label").default(""),
    origCurrency: text("orig_currency").default(""),
    origAmount: doublePrecision("orig_amount"),
    currency: text("currency").default("EUR"),
    amount: doublePrecision("amount").notNull(), // signed, payment currency (EUR)
    fee: doublePrecision("fee").default(0),
    balance: doublePrecision("balance"),
    account: text("account").default(""),
    mcc: text("mcc").default(""),
    // user enrichment
    categoryId: text("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    vatRateId: text("vat_rate_id").references(() => vatRates.id, { onDelete: "set null" }),
    note: text("note").default(""),
    reconciled: boolean("reconciled").notNull().default(false),
    // Excluded from the books entirely: internal pot transfers, personal spend that
    // landed on the wrong card, duplicate imports. Still stored, because deleting a
    // bank line loses the audit trail — but counted nowhere.
    excluded: boolean("excluded").notNull().default(false),
    excludedReason: text("excluded_reason").default(""),
    importBatch: text("import_batch"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    index("tx_booked_idx").on(t.tenantId, t.bookedDate),
    index("tx_cat_idx").on(t.tenantId, t.categoryId),
    index("tx_excluded_idx").on(t.tenantId, t.excluded),
  ],
);

export const customers = pgTable(
  "customers",
  {
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    email: text("email").default(""),
    vatNumber: text("vat_number").default(""),
    addressLine1: text("address_line1").default(""),
    addressLine2: text("address_line2").default(""),
    city: text("city").default(""),
    country: text("country").default("Ireland"),
    notes: text("notes").default(""),
    archived: boolean("archived").notNull().default(false),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("cust_tenant_idx").on(t.tenantId)],
);

export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    description: text("description").default(""),
    unitPrice: doublePrecision("unit_price").notNull().default(0), // net (ex-VAT)
    vatRateId: text("vat_rate_id").references(() => vatRates.id, { onDelete: "set null" }),
    kind: text("kind").notNull().default("service"), // 'service' | 'good'
    incomeCategoryId: text("income_category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    sku: text("sku").default(""),
    archived: boolean("archived").notNull().default(false),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("prod_tenant_idx").on(t.tenantId)],
);

export const invoices = pgTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    number: text("number").notNull(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("draft"), // draft|sent|paid|partial|void
    issueDate: text("issue_date").notNull(),
    dueDate: text("due_date"),
    currency: text("currency").notNull().default("EUR"),
    notes: text("notes").default(""),
    terms: text("terms").default(""),
    subtotal: doublePrecision("subtotal").notNull().default(0),
    vatTotal: doublePrecision("vat_total").notNull().default(0),
    total: doublePrecision("total").notNull().default(0),
    amountPaid: doublePrecision("amount_paid").notNull().default(0),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    index("inv_cust_idx").on(t.tenantId, t.customerId),
    index("inv_status_idx").on(t.tenantId, t.status),
    // An invoice number is the tenant's own reference and must not repeat within
    // the tenant. Enforced here, not just by the sequence, so a supplied number
    // that collides fails loudly instead of quietly duplicating.
    uniqueIndex("inv_number_idx").on(t.tenantId, t.number),
  ],
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    productId: text("product_id").references(() => products.id, { onDelete: "set null" }),
    description: text("description").notNull().default(""),
    quantity: doublePrecision("quantity").notNull().default(1),
    unitPrice: doublePrecision("unit_price").notNull().default(0), // net
    vatRateId: text("vat_rate_id").references(() => vatRates.id, { onDelete: "set null" }),
    vatRate: doublePrecision("vat_rate").notNull().default(0), // snapshot at line time
    lineNet: doublePrecision("line_net").notNull().default(0),
    lineVat: doublePrecision("line_vat").notNull().default(0),
    lineTotal: doublePrecision("line_total").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("line_inv_idx").on(t.tenantId, t.invoiceId)],
);

export const payments = pgTable(
  "payments",
  {
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // payment received date — drives cash-basis VAT
    amount: doublePrecision("amount").notNull(),
    method: text("method").default("bank"),
    transactionId: text("transaction_id"), // optional link to bank tx
    note: text("note").default(""),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    index("pay_inv_idx").on(t.tenantId, t.invoiceId),
    index("pay_date_idx").on(t.tenantId, t.date),
    // transactions has a composite primary key, so this FK must be composite too.
    foreignKey({
      columns: [t.tenantId, t.transactionId],
      foreignColumns: [transactions.tenantId, transactions.id],
      name: "pay_tx_fk",
    }).onDelete("set null"),
  ],
);

// --- Recurring invoices ----------------------------------------------------
// Templates that spawn real invoices on a schedule. No background worker; due
// invoices are generated on demand (app open, or the MCP tool).
export const recurringInvoices = pgTable(
  "recurring_invoices",
  {
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    name: text("name").notNull().default(""), // optional label
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("active"), // active | paused
    frequency: text("frequency").notNull().default("monthly"), // weekly|monthly|quarterly|yearly
    interval: integer("interval").notNull().default(1), // every N periods
    startDate: text("start_date").notNull(),
    nextRunDate: text("next_run_date").notNull(),
    endDate: text("end_date"), // optional stop date
    occurrencesLimit: integer("occurrences_limit"), // optional max count
    occurrencesCount: integer("occurrences_count").notNull().default(0),
    dueDays: integer("due_days").notNull().default(30),
    autoSend: boolean("auto_send").notNull().default(false),
    notes: text("notes").default(""),
    terms: text("terms").default(""),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    index("rec_next_idx").on(t.tenantId, t.nextRunDate),
    index("rec_cust_idx").on(t.tenantId, t.customerId),
  ],
);

export const recurringInvoiceLines = pgTable(
  "recurring_invoice_lines",
  {
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    recurringId: text("recurring_id")
      .notNull()
      .references(() => recurringInvoices.id, { onDelete: "cascade" }),
    productId: text("product_id").references(() => products.id, { onDelete: "set null" }),
    description: text("description").notNull().default(""),
    quantity: doublePrecision("quantity").notNull().default(1),
    unitPrice: doublePrecision("unit_price").notNull().default(0),
    vatRateId: text("vat_rate_id").references(() => vatRates.id, { onDelete: "set null" }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("recline_rec_idx").on(t.tenantId, t.recurringId)],
);

// --- Receipt attachments ----------------------------------------------------
// Files (images/PDFs) attached to a bank transaction. The blob lives in Vercel
// Blob (private); only metadata + the blob pathname is stored here.
export const receipts = pgTable(
  "receipts",
  {
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    transactionId: text("transaction_id").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull().default("application/octet-stream"),
    size: integer("size").notNull().default(0),
    storagePath: text("storage_path").notNull(), // blob pathname
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    index("receipt_tx_idx").on(t.tenantId, t.transactionId),
    // Composite, for the same reason as payments.transaction_id.
    foreignKey({
      columns: [t.tenantId, t.transactionId],
      foreignColumns: [transactions.tenantId, transactions.id],
      name: "receipt_tx_fk",
    }).onDelete("cascade"),
  ],
);

// --- Categorisation rules ---------------------------------------------------
// Auto-assign category + VAT to transactions whose text/MCC matches. Lower
// sortOrder runs first; first matching rule wins. Applied on import and via a
// manual "apply rules" sweep.
export const categoryRules = pgTable(
  "category_rules",
  {
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    name: text("name").default(""),
    matchField: text("match_field").notNull().default("description"), // description|reference|payer|mcc|any
    matchType: text("match_type").notNull().default("contains"), // contains|equals|startsWith|regex
    matchValue: text("match_value").notNull().default(""),
    direction: text("direction").notNull().default("any"), // any|in|out
    categoryId: text("category_id").references(() => categories.id, { onDelete: "set null" }),
    vatRateId: text("vat_rate_id").references(() => vatRates.id, { onDelete: "set null" }),
    enabled: boolean("enabled").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    timesApplied: integer("times_applied").notNull().default(0),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("rule_order_idx").on(t.tenantId, t.sortOrder)],
);

// --- Payroll (Irish PAYE Modernisation) ------------------------------------
// "Lighter calc" model: deductions are computed from the imported RPN figures
// (credits, SRCOP, tax rates, USC bands, PRSI class) and are fully overridable
// per payslip. Field names mirror Revenue's PSR/RPN data-items spec.

export const employees = pgTable(
  "employees",
  {
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    firstName: text("first_name").notNull().default(""),
    familyName: text("family_name").notNull().default(""),
    ppsn: text("ppsn").default(""),
    employerReference: text("employer_reference").default(""), // internal staff id
    employmentId: text("employment_id").notNull().default("1"), // PAYE Mod Employment ID
    dob: text("dob"),
    addressLine1: text("address_line1").default(""),
    addressLine2: text("address_line2").default(""),
    city: text("city").default(""),
    email: text("email").default(""),
    startDate: text("start_date"),
    dateOfLeaving: text("date_of_leaving"),
    director: text("director").default(""), // ''|'proprietary'|'non-proprietary'
    payFrequency: text("pay_frequency").notNull().default("Monthly"),
    standardGross: doublePrecision("standard_gross").notNull().default(0), // default monthly gross
    pensionEmployeePct: doublePrecision("pension_employee_pct").notNull().default(0),
    prsiClass: text("prsi_class").default("A"), // fallback if no RPN
    status: text("status").notNull().default("active"), // active|leaver
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("emp_ppsn_idx").on(t.tenantId, t.ppsn)],
);

export const rpns = pgTable(
  "rpns",
  {
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    employeeId: text("employee_id").references(() => employees.id, { onDelete: "cascade" }), // nullable until linked
    taxYear: integer("tax_year").notNull(),
    rpnNumber: text("rpn_number").notNull().default(""),
    rpnIssueDate: text("rpn_issue_date"),
    // identity from the RPN
    firstName: text("first_name").default(""),
    familyName: text("family_name").default(""),
    ppsn: text("ppsn").default(""),
    employmentId: text("employment_id").default(""),
    employerReference: text("employer_reference").default(""),
    // instruction
    incomeTaxBasis: text("income_tax_basis").default("Cumulative"), // Cumulative|Week 1|Emergency
    exclusionOrder: boolean("exclusion_order").notNull().default(false),
    effectiveDate: text("effective_date"),
    endDate: text("end_date"),
    payForIncomeTaxToDate: doublePrecision("pay_for_income_tax_to_date").default(0),
    incomeTaxDeductedToDate: doublePrecision("income_tax_deducted_to_date").default(0),
    yearlyTaxCredit: doublePrecision("yearly_tax_credit").default(0),
    taxRate1Pct: doublePrecision("tax_rate1_pct").default(0.2),
    yearlyRate1CutOff: doublePrecision("yearly_rate1_cutoff").default(0), // SRCOP
    taxRate2Pct: doublePrecision("tax_rate2_pct").default(0.4),
    prsiExempt: boolean("prsi_exempt").notNull().default(false),
    prsiClass: text("prsi_class").default(""),
    uscStatus: text("usc_status").default("Ordinary"), // Ordinary|Exempt
    uscBands: text("usc_bands").default("[]"), // JSON [{rate, yearlyCutOff}]
    payForUscToDate: doublePrecision("pay_for_usc_to_date").default(0),
    uscDeductedToDate: doublePrecision("usc_deducted_to_date").default(0),
    lptToDeduct: doublePrecision("lpt_to_deduct").default(0),
    employmentCessationDate: text("employment_cessation_date"),
    statePensionContributory: boolean("state_pension_contributory").notNull().default(false),
    rawJson: text("raw_json").default(""),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    index("rpn_emp_idx").on(t.tenantId, t.employeeId),
    index("rpn_year_idx").on(t.tenantId, t.taxYear),
  ],
);

export const payRuns = pgTable(
  "pay_runs",
  {
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    taxYear: integer("tax_year").notNull(),
    periodNo: integer("period_no").notNull(), // 1-12 for monthly
    payDate: text("pay_date").notNull(),
    frequency: text("frequency").notNull().default("Monthly"),
    payrollRunReference: text("payroll_run_reference").notNull(),
    status: text("status").notNull().default("draft"), // draft|finalised
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("run_tenant_idx").on(t.tenantId)],
);

export const payslips = pgTable(
  "payslips",
  {
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    payRunId: text("pay_run_id")
      .notNull()
      .references(() => payRuns.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    // RPN snapshot used for this slip
    rpnNumber: text("rpn_number").default(""),
    incomeTaxBasis: text("income_tax_basis").default("Cumulative"),
    exclusionOrder: boolean("exclusion_order").notNull().default(false),
    taxCreditsThisPeriod: doublePrecision("tax_credits_this_period").default(0),
    standardRateCutOff: doublePrecision("standard_rate_cutoff").default(0),
    // pay + statutory deductions (all overridable)
    grossPay: doublePrecision("gross_pay").notNull().default(0),
    pensionEmployee: doublePrecision("pension_employee").notNull().default(0),
    pensionEmployer: doublePrecision("pension_employer").notNull().default(0),
    payForIncomeTax: doublePrecision("pay_for_income_tax").notNull().default(0),
    incomeTaxPaid: doublePrecision("income_tax_paid").notNull().default(0),
    payForEmployeePrsi: doublePrecision("pay_for_employee_prsi").notNull().default(0),
    payForEmployerPrsi: doublePrecision("pay_for_employer_prsi").notNull().default(0),
    employeePrsi: doublePrecision("employee_prsi").notNull().default(0),
    employerPrsi: doublePrecision("employer_prsi").notNull().default(0),
    prsiClass: text("prsi_class").default("A"),
    insurableWeeks: integer("insurable_weeks").notNull().default(4),
    prsiExempt: boolean("prsi_exempt").notNull().default(false),
    payForUsc: doublePrecision("pay_for_usc").notNull().default(0),
    uscStatus: text("usc_status").default("Ordinary"),
    uscPaid: doublePrecision("usc_paid").notNull().default(0),
    lptDeducted: doublePrecision("lpt_deducted").notNull().default(0),
    otherDeductions: doublePrecision("other_deductions").notNull().default(0),
    otherDeductionsLabel: text("other_deductions_label").default(""),
    netPay: doublePrecision("net_pay").notNull().default(0),
    notes: text("notes").default(""),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    index("slip_run_idx").on(t.tenantId, t.payRunId),
    index("slip_emp_idx").on(t.tenantId, t.employeeId),
  ],
);

export type Tenant = typeof tenants.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type VatRate = typeof vatRates.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceLine = typeof invoiceLines.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type RecurringInvoice = typeof recurringInvoices.$inferSelect;
export type RecurringInvoiceLine = typeof recurringInvoiceLines.$inferSelect;
export type Receipt = typeof receipts.$inferSelect;
export type CategoryRule = typeof categoryRules.$inferSelect;
export type Employee = typeof employees.$inferSelect;
export type Rpn = typeof rpns.$inferSelect;
export type PayRun = typeof payRuns.$inferSelect;
export type Payslip = typeof payslips.$inferSelect;
