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
