import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Conventions
// - Money is stored as REAL in EUR. The app is EUR-only by design.
// - Bank-out is negative, bank-in is positive (matches the Revolut statement).
// - Timestamps are ISO-8601 strings (text) for portability across engines.
// - `id` columns are text UUIDs except bank transactions, which reuse the
//   provider's own transaction id so re-imports dedupe naturally.
// ---------------------------------------------------------------------------

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(), // single row, id = 1
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

export const vatRates = sqliteTable("vat_rates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  rate: real("rate").notNull(), // 0.23 => 23%
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  // Irish VAT return box mapping for purchases/sales aggregation.
  exempt: integer("exempt", { mode: "boolean" }).notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // 'income' | 'expense'
  defaultVatRateId: text("default_vat_rate_id"),
  // Whether a tx in this category carries claimable/charged VAT at all.
  vatApplicable: integer("vat_applicable", { mode: "boolean" })
    .notNull()
    .default(true),
  color: text("color").default("#9ca3af"),
  createdAt: text("created_at").notNull().default(now),
});

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(), // provider tx id (dedupe key)
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
    origAmount: real("orig_amount"),
    currency: text("currency").default("EUR"),
    amount: real("amount").notNull(), // signed, payment currency (EUR)
    fee: real("fee").default(0),
    balance: real("balance"),
    account: text("account").default(""),
    mcc: text("mcc").default(""),
    // user enrichment
    categoryId: text("category_id"),
    vatRateId: text("vat_rate_id"),
    note: text("note").default(""),
    reconciled: integer("reconciled", { mode: "boolean" })
      .notNull()
      .default(false),
    // Excluded from the books entirely: internal pot transfers, personal spend that
    // landed on the wrong card, duplicate imports. Still stored, because deleting a
    // bank line loses the audit trail — but counted nowhere.
    excluded: integer("excluded", { mode: "boolean" }).notNull().default(false),
    excludedReason: text("excluded_reason").default(""),
    // link to an invoice payment if this tx settles an invoice
    importBatch: text("import_batch"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => ({
    bookedIdx: index("tx_booked_idx").on(t.bookedDate),
    catIdx: index("tx_cat_idx").on(t.categoryId),
  }),
);

export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").default(""),
  vatNumber: text("vat_number").default(""),
  addressLine1: text("address_line1").default(""),
  addressLine2: text("address_line2").default(""),
  city: text("city").default(""),
  country: text("country").default("Ireland"),
  notes: text("notes").default(""),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(now),
});

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").default(""),
  unitPrice: real("unit_price").notNull().default(0), // net (ex-VAT)
  vatRateId: text("vat_rate_id"),
  kind: text("kind").notNull().default("service"), // 'service' | 'good'
  incomeCategoryId: text("income_category_id"),
  sku: text("sku").default(""),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(now),
});

export const invoices = sqliteTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    number: text("number").notNull(),
    customerId: text("customer_id").notNull(),
    status: text("status").notNull().default("draft"), // draft|sent|paid|partial|void
    issueDate: text("issue_date").notNull(),
    dueDate: text("due_date"),
    currency: text("currency").notNull().default("EUR"),
    notes: text("notes").default(""),
    terms: text("terms").default(""),
    subtotal: real("subtotal").notNull().default(0),
    vatTotal: real("vat_total").notNull().default(0),
    total: real("total").notNull().default(0),
    amountPaid: real("amount_paid").notNull().default(0),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => ({
    custIdx: index("inv_cust_idx").on(t.customerId),
    statusIdx: index("inv_status_idx").on(t.status),
  }),
);

export const invoiceLines = sqliteTable("invoice_lines", {
  id: text("id").primaryKey(),
  invoiceId: text("invoice_id").notNull(),
  productId: text("product_id"),
  description: text("description").notNull().default(""),
  quantity: real("quantity").notNull().default(1),
  unitPrice: real("unit_price").notNull().default(0), // net
  vatRateId: text("vat_rate_id"),
  vatRate: real("vat_rate").notNull().default(0), // snapshot at line time
  lineNet: real("line_net").notNull().default(0),
  lineVat: real("line_vat").notNull().default(0),
  lineTotal: real("line_total").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id").notNull(),
    date: text("date").notNull(), // payment received date — drives cash-basis VAT
    amount: real("amount").notNull(),
    method: text("method").default("bank"),
    transactionId: text("transaction_id"), // optional link to bank tx
    note: text("note").default(""),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => ({
    invIdx: index("pay_inv_idx").on(t.invoiceId),
    dateIdx: index("pay_date_idx").on(t.date),
  }),
);

// --- Recurring invoices ----------------------------------------------------
// Templates that spawn real invoices on a schedule. No background worker (this
// is a local app); due invoices are generated when the app is opened.
export const recurringInvoices = sqliteTable(
  "recurring_invoices",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().default(""), // optional label
    customerId: text("customer_id").notNull(),
    status: text("status").notNull().default("active"), // active | paused
    frequency: text("frequency").notNull().default("monthly"), // weekly|monthly|quarterly|yearly
    interval: integer("interval").notNull().default(1), // every N periods
    startDate: text("start_date").notNull(),
    nextRunDate: text("next_run_date").notNull(),
    endDate: text("end_date"), // optional stop date
    occurrencesLimit: integer("occurrences_limit"), // optional max count
    occurrencesCount: integer("occurrences_count").notNull().default(0),
    dueDays: integer("due_days").notNull().default(30),
    autoSend: integer("auto_send", { mode: "boolean" }).notNull().default(false),
    notes: text("notes").default(""),
    terms: text("terms").default(""),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => ({
    nextIdx: index("rec_next_idx").on(t.nextRunDate),
    custIdx: index("rec_cust_idx").on(t.customerId),
  }),
);

export const recurringInvoiceLines = sqliteTable("recurring_invoice_lines", {
  id: text("id").primaryKey(),
  recurringId: text("recurring_id").notNull(),
  productId: text("product_id"),
  description: text("description").notNull().default(""),
  quantity: real("quantity").notNull().default(1),
  unitPrice: real("unit_price").notNull().default(0),
  vatRateId: text("vat_rate_id"),
  sortOrder: integer("sort_order").notNull().default(0),
});

// --- Receipt attachments ----------------------------------------------------
// Files (images/PDFs) attached to a bank transaction. The blob lives on disk
// under data/receipts; only metadata + path is stored here.
export const receipts = sqliteTable(
  "receipts",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull().default("application/octet-stream"),
    size: integer("size").notNull().default(0),
    storagePath: text("storage_path").notNull(), // relative to project root
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => ({
    txIdx: index("receipt_tx_idx").on(t.transactionId),
  }),
);

// --- Categorisation rules ---------------------------------------------------
// Auto-assign category + VAT to transactions whose text/MCC matches. Lower
// sortOrder runs first; first matching rule wins. Applied on import and via a
// manual "apply rules" sweep.
export const categoryRules = sqliteTable(
  "category_rules",
  {
    id: text("id").primaryKey(),
    name: text("name").default(""),
    matchField: text("match_field").notNull().default("description"), // description|reference|payer|mcc|any
    matchType: text("match_type").notNull().default("contains"), // contains|equals|startsWith|regex
    matchValue: text("match_value").notNull().default(""),
    direction: text("direction").notNull().default("any"), // any|in|out
    categoryId: text("category_id"),
    vatRateId: text("vat_rate_id"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    timesApplied: integer("times_applied").notNull().default(0),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => ({
    orderIdx: index("rule_order_idx").on(t.sortOrder),
  }),
);

// --- Payroll (Irish PAYE Modernisation) ------------------------------------
// "Lighter calc" model: deductions are computed from the imported RPN figures
// (credits, SRCOP, tax rates, USC bands, PRSI class) and are fully overridable
// per payslip. Field names mirror Revenue's PSR/RPN data-items spec.

export const employees = sqliteTable(
  "employees",
  {
    id: text("id").primaryKey(),
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
    standardGross: real("standard_gross").notNull().default(0), // default monthly gross
    pensionEmployeePct: real("pension_employee_pct").notNull().default(0),
    prsiClass: text("prsi_class").default("A"), // fallback if no RPN
    status: text("status").notNull().default("active"), // active|leaver
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => ({
    ppsnIdx: index("emp_ppsn_idx").on(t.ppsn),
  }),
);

export const rpns = sqliteTable(
  "rpns",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id"), // matched employee (nullable until linked)
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
    exclusionOrder: integer("exclusion_order", { mode: "boolean" }).notNull().default(false),
    effectiveDate: text("effective_date"),
    endDate: text("end_date"),
    payForIncomeTaxToDate: real("pay_for_income_tax_to_date").default(0),
    incomeTaxDeductedToDate: real("income_tax_deducted_to_date").default(0),
    yearlyTaxCredit: real("yearly_tax_credit").default(0),
    taxRate1Pct: real("tax_rate1_pct").default(0.2),
    yearlyRate1CutOff: real("yearly_rate1_cutoff").default(0), // SRCOP
    taxRate2Pct: real("tax_rate2_pct").default(0.4),
    prsiExempt: integer("prsi_exempt", { mode: "boolean" }).notNull().default(false),
    prsiClass: text("prsi_class").default(""),
    uscStatus: text("usc_status").default("Ordinary"), // Ordinary|Exempt
    uscBands: text("usc_bands").default("[]"), // JSON [{rate, yearlyCutOff}]
    payForUscToDate: real("pay_for_usc_to_date").default(0),
    uscDeductedToDate: real("usc_deducted_to_date").default(0),
    lptToDeduct: real("lpt_to_deduct").default(0),
    employmentCessationDate: text("employment_cessation_date"),
    statePensionContributory: integer("state_pension_contributory", { mode: "boolean" }).notNull().default(false),
    rawJson: text("raw_json").default(""),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => ({
    empIdx: index("rpn_emp_idx").on(t.employeeId),
    yearIdx: index("rpn_year_idx").on(t.taxYear),
  }),
);

export const payRuns = sqliteTable("pay_runs", {
  id: text("id").primaryKey(),
  taxYear: integer("tax_year").notNull(),
  periodNo: integer("period_no").notNull(), // 1-12 for monthly
  payDate: text("pay_date").notNull(),
  frequency: text("frequency").notNull().default("Monthly"),
  payrollRunReference: text("payroll_run_reference").notNull(),
  status: text("status").notNull().default("draft"), // draft|finalised
  createdAt: text("created_at").notNull().default(now),
});

export const payslips = sqliteTable(
  "payslips",
  {
    id: text("id").primaryKey(),
    payRunId: text("pay_run_id").notNull(),
    employeeId: text("employee_id").notNull(),
    // RPN snapshot used for this slip
    rpnNumber: text("rpn_number").default(""),
    incomeTaxBasis: text("income_tax_basis").default("Cumulative"),
    exclusionOrder: integer("exclusion_order", { mode: "boolean" }).notNull().default(false),
    taxCreditsThisPeriod: real("tax_credits_this_period").default(0),
    standardRateCutOff: real("standard_rate_cutoff").default(0),
    // pay + statutory deductions (all overridable)
    grossPay: real("gross_pay").notNull().default(0),
    pensionEmployee: real("pension_employee").notNull().default(0),
    pensionEmployer: real("pension_employer").notNull().default(0),
    payForIncomeTax: real("pay_for_income_tax").notNull().default(0),
    incomeTaxPaid: real("income_tax_paid").notNull().default(0),
    payForEmployeePrsi: real("pay_for_employee_prsi").notNull().default(0),
    payForEmployerPrsi: real("pay_for_employer_prsi").notNull().default(0),
    employeePrsi: real("employee_prsi").notNull().default(0),
    employerPrsi: real("employer_prsi").notNull().default(0),
    prsiClass: text("prsi_class").default("A"),
    insurableWeeks: integer("insurable_weeks").notNull().default(4),
    prsiExempt: integer("prsi_exempt", { mode: "boolean" }).notNull().default(false),
    payForUsc: real("pay_for_usc").notNull().default(0),
    uscStatus: text("usc_status").default("Ordinary"),
    uscPaid: real("usc_paid").notNull().default(0),
    lptDeducted: real("lpt_deducted").notNull().default(0),
    otherDeductions: real("other_deductions").notNull().default(0),
    otherDeductionsLabel: text("other_deductions_label").default(""),
    netPay: real("net_pay").notNull().default(0),
    notes: text("notes").default(""),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => ({
    runIdx: index("slip_run_idx").on(t.payRunId),
    empIdx: index("slip_emp_idx").on(t.employeeId),
  }),
);

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
