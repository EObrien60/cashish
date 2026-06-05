import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const { settings, vatRates, categories } = schema;
type DB = BetterSQLite3Database<typeof schema>;

// Idempotent seed. Uses fixed ids + onConflictDoNothing so it's safe to run
// concurrently from multiple processes (parallel build workers) without
// double-inserting. Runs automatically on first connection (see client.ts).

const IE_VAT_RATES = [
  { id: "vat-standard", name: "Standard 23%", rate: 0.23, isDefault: true, exempt: false, sortOrder: 1 },
  { id: "vat-reduced", name: "Reduced 13.5%", rate: 0.135, isDefault: false, exempt: false, sortOrder: 2 },
  { id: "vat-second", name: "Second reduced 9%", rate: 0.09, isDefault: false, exempt: false, sortOrder: 3 },
  { id: "vat-zero", name: "Zero 0%", rate: 0, isDefault: false, exempt: false, sortOrder: 4 },
  { id: "vat-exempt", name: "Exempt", rate: 0, isDefault: false, exempt: true, sortOrder: 5 },
];

const DEFAULT_CATEGORIES: (typeof categories.$inferInsert)[] = [
  { id: "cat-sales", name: "Sales", kind: "income", color: "#0f7b5f", defaultVatRateId: "vat-standard" },
  { id: "cat-other-income", name: "Other income", kind: "income", color: "#1aa37c", defaultVatRateId: "vat-zero" },
  { id: "cat-interest", name: "Interest received", kind: "income", color: "#3aa0a0", defaultVatRateId: "vat-exempt", vatApplicable: false },
  { id: "cat-software", name: "Software & subscriptions", kind: "expense", color: "#6366f1", defaultVatRateId: "vat-standard" },
  { id: "cat-cogs", name: "Cost of sales", kind: "expense", color: "#c0492f", defaultVatRateId: "vat-standard" },
  { id: "cat-travel", name: "Travel & subsistence", kind: "expense", color: "#d97706", defaultVatRateId: "vat-standard" },
  { id: "cat-office", name: "Office & equipment", kind: "expense", color: "#0891b2", defaultVatRateId: "vat-standard" },
  { id: "cat-marketing", name: "Marketing & advertising", kind: "expense", color: "#db2777", defaultVatRateId: "vat-standard" },
  { id: "cat-professional", name: "Professional & legal fees", kind: "expense", color: "#7c3aed", defaultVatRateId: "vat-standard" },
  { id: "cat-bank", name: "Bank charges & fees", kind: "expense", color: "#64748b", defaultVatRateId: "vat-exempt", vatApplicable: false },
  { id: "cat-rent", name: "Rent & utilities", kind: "expense", color: "#0d9488", defaultVatRateId: "vat-standard" },
  { id: "cat-wages", name: "Wages & salaries", kind: "expense", color: "#475569", defaultVatRateId: "vat-exempt", vatApplicable: false },
  { id: "cat-tax", name: "Taxes & Revenue", kind: "expense", color: "#9f1239", defaultVatRateId: "vat-exempt", vatApplicable: false },
  { id: "cat-drawings", name: "Owner drawings / transfers", kind: "expense", color: "#94a3b8", defaultVatRateId: "vat-exempt", vatApplicable: false },
  { id: "cat-misc", name: "Other expenses", kind: "expense", color: "#9ca3af", defaultVatRateId: "vat-standard" },
];

export function seedInto(db: DB) {
  for (const r of IE_VAT_RATES) {
    db.insert(vatRates).values(r).onConflictDoNothing().run();
  }
  for (const c of DEFAULT_CATEGORIES) {
    db.insert(categories).values(c).onConflictDoNothing().run();
  }
  db.insert(settings).values({ id: 1 }).onConflictDoNothing().run();
}
