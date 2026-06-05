import type DatabaseType from "better-sqlite3";

// Schema DDL applied on connection open (CREATE IF NOT EXISTS — idempotent and
// safe to run from multiple processes). Keeps the local app zero-config: opening
// the app creates the SQLite file + tables if absent. Mirrors schema.ts. For a
// real engine swap you'd switch to drizzle-kit migrations; for single-user
// SQLite this is the simplest correct thing.

export const DDL = `
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY,
  business_name TEXT NOT NULL DEFAULT 'My Business',
  address_line1 TEXT DEFAULT '',
  address_line2 TEXT DEFAULT '',
  city TEXT DEFAULT '',
  country TEXT DEFAULT 'Ireland',
  vat_number TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  iban TEXT DEFAULT '',
  bic TEXT DEFAULT '',
  invoice_prefix TEXT NOT NULL DEFAULT 'INV-',
  next_invoice_seq INTEGER NOT NULL DEFAULT 1,
  invoice_footer TEXT DEFAULT 'Thank you for your business.',
  vat_basis TEXT NOT NULL DEFAULT 'cash',
  logo_data_url TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS vat_rates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rate REAL NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  exempt INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  default_vat_rate_id TEXT,
  vat_applicable INTEGER NOT NULL DEFAULT 1,
  color TEXT DEFAULT '#9ca3af',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  date_started TEXT,
  date_completed TEXT,
  booked_date TEXT NOT NULL,
  type TEXT,
  state TEXT,
  description TEXT DEFAULT '',
  reference TEXT DEFAULT '',
  payer TEXT DEFAULT '',
  card_label TEXT DEFAULT '',
  orig_currency TEXT DEFAULT '',
  orig_amount REAL,
  currency TEXT DEFAULT 'EUR',
  amount REAL NOT NULL,
  fee REAL DEFAULT 0,
  balance REAL,
  account TEXT DEFAULT '',
  mcc TEXT DEFAULT '',
  category_id TEXT,
  vat_rate_id TEXT,
  note TEXT DEFAULT '',
  reconciled INTEGER NOT NULL DEFAULT 0,
  import_batch TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS tx_booked_idx ON transactions (booked_date);
CREATE INDEX IF NOT EXISTS tx_cat_idx ON transactions (category_id);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT DEFAULT '',
  vat_number TEXT DEFAULT '',
  address_line1 TEXT DEFAULT '',
  address_line2 TEXT DEFAULT '',
  city TEXT DEFAULT '',
  country TEXT DEFAULT 'Ireland',
  notes TEXT DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  unit_price REAL NOT NULL DEFAULT 0,
  vat_rate_id TEXT,
  kind TEXT NOT NULL DEFAULT 'service',
  income_category_id TEXT,
  sku TEXT DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  issue_date TEXT NOT NULL,
  due_date TEXT,
  currency TEXT NOT NULL DEFAULT 'EUR',
  notes TEXT DEFAULT '',
  terms TEXT DEFAULT '',
  subtotal REAL NOT NULL DEFAULT 0,
  vat_total REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  amount_paid REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS inv_cust_idx ON invoices (customer_id);
CREATE INDEX IF NOT EXISTS inv_status_idx ON invoices (status);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  product_id TEXT,
  description TEXT NOT NULL DEFAULT '',
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  vat_rate_id TEXT,
  vat_rate REAL NOT NULL DEFAULT 0,
  line_net REAL NOT NULL DEFAULT 0,
  line_vat REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT DEFAULT 'bank',
  transaction_id TEXT,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS pay_inv_idx ON payments (invoice_id);
CREATE INDEX IF NOT EXISTS pay_date_idx ON payments (date);

CREATE TABLE IF NOT EXISTS recurring_invoices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  customer_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  frequency TEXT NOT NULL DEFAULT 'monthly',
  interval INTEGER NOT NULL DEFAULT 1,
  start_date TEXT NOT NULL,
  next_run_date TEXT NOT NULL,
  end_date TEXT,
  occurrences_limit INTEGER,
  occurrences_count INTEGER NOT NULL DEFAULT 0,
  due_days INTEGER NOT NULL DEFAULT 30,
  auto_send INTEGER NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  terms TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS rec_next_idx ON recurring_invoices (next_run_date);
CREATE INDEX IF NOT EXISTS rec_cust_idx ON recurring_invoices (customer_id);

CREATE TABLE IF NOT EXISTS recurring_invoice_lines (
  id TEXT PRIMARY KEY,
  recurring_id TEXT NOT NULL,
  product_id TEXT,
  description TEXT NOT NULL DEFAULT '',
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  vat_rate_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS receipt_tx_idx ON receipts (transaction_id);

CREATE TABLE IF NOT EXISTS category_rules (
  id TEXT PRIMARY KEY,
  name TEXT DEFAULT '',
  match_field TEXT NOT NULL DEFAULT 'description',
  match_type TEXT NOT NULL DEFAULT 'contains',
  match_value TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL DEFAULT 'any',
  category_id TEXT,
  vat_rate_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  times_applied INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS rule_order_idx ON category_rules (sort_order);
`;

// Bump when DDL changes so existing databases re-run applySchema (all
// statements are IF NOT EXISTS, so re-running is safe and only adds what's
// missing). Gating on user_version avoids re-running DDL on every connection.
export const SCHEMA_VERSION = 2;

export function applySchema(sqlite: DatabaseType.Database) {
  sqlite.exec(DDL);
}
