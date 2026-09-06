import { eq } from "drizzle-orm";
import { db, schema } from "@cashish/core/db";
import { uid } from "@/lib/id";
import type { TenantKind, TenantRegion } from "@cashish/core/db";

const { tenants, settings, vatRates, categories } = schema;

// ---------------------------------------------------------------------------
// Per-tenant seed. Runs once, when a tenant is created — not on connection
// open, which is what the SQLite build did.
//
// The base ids below are namespaced per tenant (`<tenantId>:vat-standard`), so
// every tenant gets its own editable copy of the Irish VAT rates and the
// default chart of accounts while `id` stays a plain single-column primary key.
// The alternative — composite (tenant_id, id) keys — would force composite
// foreign keys onto all eight tables that reference a rate or a category.
// ---------------------------------------------------------------------------

export const scopedId = (tenantIdValue: string, baseId: string) => `${tenantIdValue}:${baseId}`;

export const IE_VAT_RATES = [
  { id: "vat-standard", name: "Standard 23%", rate: 0.23, isDefault: true, exempt: false, sortOrder: 1 },
  { id: "vat-reduced", name: "Reduced 13.5%", rate: 0.135, isDefault: false, exempt: false, sortOrder: 2 },
  { id: "vat-second", name: "Second reduced 9%", rate: 0.09, isDefault: false, exempt: false, sortOrder: 3 },
  { id: "vat-zero", name: "Zero 0%", rate: 0, isDefault: false, exempt: false, sortOrder: 4 },
  { id: "vat-exempt", name: "Exempt", rate: 0, isDefault: false, exempt: true, sortOrder: 5 },
] as const;

type SeedCategory = {
  id: string;
  name: string;
  kind: "income" | "expense";
  color: string;
  defaultVatRateId: string;
  vatApplicable?: boolean;
  costOfSales?: boolean;
};

export const DEFAULT_CATEGORIES: SeedCategory[] = [
  { id: "cat-sales", name: "Sales", kind: "income", color: "#0f7b5f", defaultVatRateId: "vat-standard" },
  { id: "cat-other-income", name: "Other income", kind: "income", color: "#1aa37c", defaultVatRateId: "vat-zero" },
  { id: "cat-interest", name: "Interest received", kind: "income", color: "#3aa0a0", defaultVatRateId: "vat-exempt", vatApplicable: false },
  { id: "cat-software", name: "Software & subscriptions", kind: "expense", color: "#6366f1", defaultVatRateId: "vat-standard" },
  { id: "cat-cogs", name: "Cost of sales", kind: "expense", color: "#c0492f", defaultVatRateId: "vat-standard", costOfSales: true },
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

/**
 * A personal book's chart of accounts.
 *
 * Everyday envelopes, not a trading business's ledger: nobody categorises the
 * weekly shop as "Cost of sales". VAT is exempt across the board because a
 * household does not reclaim it — the rates still exist on the tenant so the
 * column stays non-null and a book can be switched to business later.
 */
export const PERSONAL_CATEGORIES: SeedCategory[] = [
  { id: "cat-salary", name: "Salary", kind: "income", color: "#0f7b5f", defaultVatRateId: "vat-exempt", vatApplicable: false },
  { id: "cat-other-income", name: "Other income", kind: "income", color: "#1aa37c", defaultVatRateId: "vat-exempt", vatApplicable: false },
  { id: "cat-interest", name: "Interest received", kind: "income", color: "#3aa0a0", defaultVatRateId: "vat-exempt", vatApplicable: false },
  { id: "cat-housing", name: "Rent & mortgage", kind: "expense", color: "#0d9488", defaultVatRateId: "vat-exempt", vatApplicable: false },
  { id: "cat-utilities", name: "Utilities", kind: "expense", color: "#0891b2", defaultVatRateId: "vat-exempt", vatApplicable: false },
  { id: "cat-groceries", name: "Groceries", kind: "expense", color: "#65a30d", defaultVatRateId: "vat-exempt", vatApplicable: false },
  { id: "cat-eating-out", name: "Eating out & takeaway", kind: "expense", color: "#d97706", defaultVatRateId: "vat-exempt", vatApplicable: false },
  { id: "cat-transport", name: "Transport & fuel", kind: "expense", color: "#7c3aed", defaultVatRateId: "vat-exempt", vatApplicable: false },
  { id: "cat-health", name: "Health & medical", kind: "expense", color: "#db2777", defaultVatRateId: "vat-exempt", vatApplicable: false },
  { id: "cat-subs", name: "Subscriptions", kind: "expense", color: "#6366f1", defaultVatRateId: "vat-exempt", vatApplicable: false },
  { id: "cat-shopping", name: "Shopping", kind: "expense", color: "#e11d48", defaultVatRateId: "vat-exempt", vatApplicable: false },
  { id: "cat-leisure", name: "Leisure & holidays", kind: "expense", color: "#f59e0b", defaultVatRateId: "vat-exempt", vatApplicable: false },
  { id: "cat-family", name: "Family & childcare", kind: "expense", color: "#14b8a6", defaultVatRateId: "vat-exempt", vatApplicable: false },
  { id: "cat-insurance", name: "Insurance", kind: "expense", color: "#475569", defaultVatRateId: "vat-exempt", vatApplicable: false },
  { id: "cat-bank", name: "Bank charges & fees", kind: "expense", color: "#64748b", defaultVatRateId: "vat-exempt", vatApplicable: false },
  { id: "cat-savings", name: "Savings & transfers", kind: "expense", color: "#94a3b8", defaultVatRateId: "vat-exempt", vatApplicable: false },
  { id: "cat-misc", name: "Other spending", kind: "expense", color: "#9ca3af", defaultVatRateId: "vat-exempt", vatApplicable: false },
];

/** UK rates, for when a book is created with region 'GB'. */
export const GB_VAT_RATES = [
  { id: "vat-standard", name: "Standard 20%", rate: 0.2, isDefault: true, exempt: false, sortOrder: 1 },
  { id: "vat-reduced", name: "Reduced 5%", rate: 0.05, isDefault: false, exempt: false, sortOrder: 2 },
  { id: "vat-zero", name: "Zero 0%", rate: 0, isDefault: false, exempt: false, sortOrder: 3 },
  { id: "vat-exempt", name: "Exempt", rate: 0, isDefault: false, exempt: true, sortOrder: 4 },
] as const;

/**
 * Creates a tenant with its settings row, VAT rates and default categories.
 * Everything in one transaction: a half-seeded tenant is worse than none.
 */
export async function createTenant(input: {
  slug: string;
  name: string;
  id?: string;
  kind?: TenantKind;
  region?: TenantRegion;
}) {
  const id = input.id ?? uid();
  const kind: TenantKind = input.kind ?? "business";
  const region: TenantRegion = input.region ?? "IE";
  const currency = region === "GB" ? "GBP" : "EUR";
  // A personal book gets envelopes; a business one gets a chart of accounts.
  const chart = kind === "personal" ? PERSONAL_CATEGORIES : DEFAULT_CATEGORIES;
  // Rates follow the jurisdiction, not the mode: a personal book still carries
  // them so the column stays non-null and the book can be switched later.
  const rates = region === "GB" ? GB_VAT_RATES : IE_VAT_RATES;
  const rateIds = new Set<string>(rates.map((r) => r.id));

  await db.transaction(async (trx) => {
    await trx.insert(tenants).values({ id, slug: input.slug, name: input.name, kind, region, currency });
    await trx.insert(settings).values({
      tenantId: id,
      businessName: input.name,
      // A household has no invoice series to continue.
      ...(kind === "personal" ? { invoicePrefix: "" } : {}),
    });
    await trx.insert(vatRates).values(
      rates.map((r) => ({ ...r, id: scopedId(id, r.id), tenantId: id })),
    );
    // Categories reference VAT rates, so they go in after. The UK set has no
    // second-reduced rate, so a category pointing at one falls back to exempt
    // rather than to a rate that was never inserted.
    await trx.insert(categories).values(
      chart.map((c) => ({
        ...c,
        id: scopedId(id, c.id),
        tenantId: id,
        defaultVatRateId: scopedId(id, rateIds.has(c.defaultVatRateId) ? c.defaultVatRateId : "vat-exempt"),
      })),
    );
  });
  return id;
}

export async function findTenantBySlug(slug: string) {
  const [row] = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  return row ?? null;
}
