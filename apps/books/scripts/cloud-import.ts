#!/usr/bin/env tsx
/**
 * Moves a SQLite book into a cloud tenant, once, and proves it arrived intact.
 *
 *   DATABASE_URL=… npx tsx scripts/cloud-import.ts \
 *     --from ~/cashish-backups/<stamp>/cashish.db --tenant obh
 *
 * What makes this safe rather than hopeful:
 *
 *   - it refuses a tenant that already holds any books;
 *   - it inserts in foreign-key order inside ONE transaction, so a failure
 *     halfway leaves the tenant empty rather than half-migrated;
 *   - it remaps the seeded VAT-rate and category ids, which are namespaced per
 *     tenant in Postgres and were global in SQLite;
 *   - it coerces the 0/1 integers SQLite used for booleans;
 *   - and it then reconciles row counts AND money sums between source and
 *     target, exiting non-zero on any mismatch. A migration that reports
 *     success without comparing the totals has not verified anything.
 */
import Database from "better-sqlite3";
import { eq, sql } from "drizzle-orm";
import { db, pool, schema } from "@cashish/core/db";
import { findTenantBySlug, scopedId } from "../src/db/seed";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  if (i !== -1) return args[i + 1];
  return args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
};
const has = (name: string) => args.includes(`--${name}`);

const bool = (v: unknown) => v === 1 || v === true || v === "1";
const nz = (v: unknown) => (v === null || v === undefined ? null : v);

/** Tables checked for emptiness, and reported on afterwards. */
const TABLES = [
  "transactions",
  "customers",
  "products",
  "invoices",
  "invoice_lines",
  "payments",
  "category_rules",
  "recurring_invoices",
  "recurring_invoice_lines",
  "receipts",
  "employees",
  "rpns",
  "pay_runs",
  "payslips",
] as const;

const PG_TABLE = {
  transactions: schema.transactions,
  customers: schema.customers,
  products: schema.products,
  invoices: schema.invoices,
  invoice_lines: schema.invoiceLines,
  payments: schema.payments,
  category_rules: schema.categoryRules,
  recurring_invoices: schema.recurringInvoices,
  recurring_invoice_lines: schema.recurringInvoiceLines,
  receipts: schema.receipts,
  employees: schema.employees,
  rpns: schema.rpns,
  pay_runs: schema.payRuns,
  payslips: schema.payslips,
} as const;

async function main() {
  const from = flag("from");
  const slug = flag("tenant");
  if (!from || !slug) {
    console.error("usage: cloud-import.ts --from <sqlite file> --tenant <slug> [--force]");
    process.exit(1);
  }

  const tenant = await findTenantBySlug(slug);
  if (!tenant) {
    console.error(`no tenant with slug "${slug}" — run scripts/bootstrap.ts first.`);
    process.exit(1);
  }
  const tid = tenant.id;

  const src = new Database(from, { readonly: true });
  const rows = <T>(table: string): T[] =>
    src.prepare(`SELECT * FROM "${table}"`).all() as T[];
  const srcCount = (table: string) =>
    Number((src.prepare(`SELECT COUNT(*) n FROM "${table}"`).get() as { n: number }).n);

  // --- refuse a tenant that already has books ------------------------------
  const occupied: string[] = [];
  for (const table of TABLES) {
    const [row] = await db
      .select({ n: sql<number>`count(*)` })
      .from(PG_TABLE[table])
      .where(eq(PG_TABLE[table].tenantId, tid));
    if (Number(row?.n ?? 0) > 0) occupied.push(`${table}=${row?.n}`);
  }
  if (occupied.length && !has("force")) {
    console.error(
      `tenant "${slug}" already holds books (${occupied.join(", ")}).\n` +
        "Refusing to import on top of them. Pass --force only if you mean to.",
    );
    process.exit(1);
  }

  // --- id remapping ---------------------------------------------------------
  // VAT rates and categories are seeded per tenant with namespaced ids, so every
  // reference the SQLite book holds ("vat-standard") has to be rewritten.
  const remap = new Map<string, string>();
  for (const table of ["vat_rates", "categories"] as const) {
    for (const row of rows<{ id: string }>(table)) {
      remap.set(row.id, scopedId(tid, row.id));
    }
  }
  const ref = (id: unknown): string | null => {
    if (id === null || id === undefined) return null;
    const key = String(id);
    return remap.get(key) ?? key;
  };

  const settingsRow = src.prepare("SELECT * FROM settings LIMIT 1").get() as
    | Record<string, unknown>
    | undefined;

  console.log(`importing ${from}\n  into tenant ${slug} (${tid})`);

  // --- one transaction: all of it, or none of it ----------------------------
  await db.transaction(async (trx) => {
    // Reference data first: the seed already created the tenant's copies, so the
    // source's own rates and categories are merged onto them by namespaced id.
    for (const r of rows<Record<string, any>>("vat_rates")) {
      await trx
        .update(schema.vatRates)
        .set({
          name: String(r.name),
          rate: Number(r.rate),
          isDefault: bool(r.is_default),
          exempt: bool(r.exempt),
          sortOrder: Number(r.sort_order ?? 0),
        })
        .where(eq(schema.vatRates.id, scopedId(tid, String(r.id))));
    }
    for (const r of rows<Record<string, any>>("categories")) {
      await trx
        .insert(schema.categories)
        .values({
          id: scopedId(tid, String(r.id)),
          tenantId: tid,
          name: String(r.name),
          kind: String(r.kind),
          defaultVatRateId: ref(r.default_vat_rate_id),
          vatApplicable: bool(r.vat_applicable),
          color: nz(r.color) as string | null,
        })
        .onConflictDoUpdate({
          target: schema.categories.id,
          set: {
            name: String(r.name),
            kind: String(r.kind),
            defaultVatRateId: ref(r.default_vat_rate_id),
            vatApplicable: bool(r.vat_applicable),
            color: nz(r.color) as string | null,
          },
        });
    }

    if (settingsRow) {
      const s = settingsRow;
      await trx
        .update(schema.settings)
        .set({
          businessName: String(s.business_name ?? "My Business"),
          addressLine1: nz(s.address_line1) as string | null,
          addressLine2: nz(s.address_line2) as string | null,
          city: nz(s.city) as string | null,
          country: nz(s.country) as string | null,
          vatNumber: nz(s.vat_number) as string | null,
          email: nz(s.email) as string | null,
          phone: nz(s.phone) as string | null,
          iban: nz(s.iban) as string | null,
          bic: nz(s.bic) as string | null,
          invoicePrefix: String(s.invoice_prefix ?? "INV-"),
          nextInvoiceSeq: Number(s.next_invoice_seq ?? 1),
          invoiceFooter: nz(s.invoice_footer) as string | null,
          vatBasis: String(s.vat_basis ?? "cash"),
          logoDataUrl: nz(s.logo_data_url) as string | null,
          employerRegNumber: nz(s.employer_reg_number) as string | null,
        })
        .where(eq(schema.settings.tenantId, tid));
    }

    const insert = async (table: any, values: any[]) => {
      const CHUNK = 200; // Postgres caps bind parameters at 65535.
      for (let i = 0; i < values.length; i += CHUNK) {
        if (values.length) await trx.insert(table).values(values.slice(i, i + CHUNK));
      }
    };

    await insert(
      schema.customers,
      rows<Record<string, any>>("customers").map((r) => ({
        id: String(r.id),
        tenantId: tid,
        name: String(r.name),
        email: nz(r.email),
        vatNumber: nz(r.vat_number),
        addressLine1: nz(r.address_line1),
        addressLine2: nz(r.address_line2),
        city: nz(r.city),
        country: nz(r.country),
        notes: nz(r.notes),
        archived: bool(r.archived),
        createdAt: String(r.created_at),
      })),
    );

    await insert(
      schema.products,
      rows<Record<string, any>>("products").map((r) => ({
        id: String(r.id),
        tenantId: tid,
        name: String(r.name),
        description: nz(r.description),
        unitPrice: Number(r.unit_price ?? 0),
        vatRateId: ref(r.vat_rate_id),
        kind: String(r.kind ?? "service"),
        incomeCategoryId: ref(r.income_category_id),
        sku: nz(r.sku),
        archived: bool(r.archived),
        createdAt: String(r.created_at),
      })),
    );

    await insert(
      schema.transactions,
      rows<Record<string, any>>("transactions").map((r) => ({
        id: String(r.id),
        tenantId: tid,
        dateStarted: nz(r.date_started),
        dateCompleted: nz(r.date_completed),
        bookedDate: String(r.booked_date),
        type: nz(r.type),
        state: nz(r.state),
        description: nz(r.description),
        reference: nz(r.reference),
        payer: nz(r.payer),
        cardLabel: nz(r.card_label),
        origCurrency: nz(r.orig_currency),
        origAmount: nz(r.orig_amount),
        currency: nz(r.currency),
        amount: Number(r.amount),
        fee: nz(r.fee),
        balance: nz(r.balance),
        account: nz(r.account),
        mcc: nz(r.mcc),
        categoryId: ref(r.category_id),
        vatRateId: ref(r.vat_rate_id),
        note: nz(r.note),
        reconciled: bool(r.reconciled),
        excluded: bool(r.excluded),
        excludedReason: nz(r.excluded_reason),
        importBatch: nz(r.import_batch),
        createdAt: String(r.created_at),
      })),
    );

    await insert(
      schema.invoices,
      rows<Record<string, any>>("invoices").map((r) => ({
        id: String(r.id),
        tenantId: tid,
        number: String(r.number),
        customerId: String(r.customer_id),
        status: String(r.status),
        issueDate: String(r.issue_date),
        dueDate: nz(r.due_date),
        currency: String(r.currency ?? "EUR"),
        notes: nz(r.notes),
        terms: nz(r.terms),
        subtotal: Number(r.subtotal ?? 0),
        vatTotal: Number(r.vat_total ?? 0),
        total: Number(r.total ?? 0),
        amountPaid: Number(r.amount_paid ?? 0),
        createdAt: String(r.created_at),
      })),
    );

    await insert(
      schema.invoiceLines,
      rows<Record<string, any>>("invoice_lines").map((r) => ({
        id: String(r.id),
        tenantId: tid,
        invoiceId: String(r.invoice_id),
        productId: nz(r.product_id),
        description: String(r.description ?? ""),
        quantity: Number(r.quantity ?? 1),
        unitPrice: Number(r.unit_price ?? 0),
        vatRateId: ref(r.vat_rate_id),
        vatRate: Number(r.vat_rate ?? 0),
        lineNet: Number(r.line_net ?? 0),
        lineVat: Number(r.line_vat ?? 0),
        lineTotal: Number(r.line_total ?? 0),
        sortOrder: Number(r.sort_order ?? 0),
      })),
    );

    await insert(
      schema.payments,
      rows<Record<string, any>>("payments").map((r) => ({
        id: String(r.id),
        tenantId: tid,
        invoiceId: String(r.invoice_id),
        date: String(r.date),
        amount: Number(r.amount),
        method: nz(r.method),
        transactionId: nz(r.transaction_id),
        note: nz(r.note),
        createdAt: String(r.created_at),
      })),
    );

    await insert(
      schema.categoryRules,
      rows<Record<string, any>>("category_rules").map((r) => ({
        id: String(r.id),
        tenantId: tid,
        name: nz(r.name),
        matchField: String(r.match_field),
        matchType: String(r.match_type),
        matchValue: String(r.match_value ?? ""),
        direction: String(r.direction ?? "any"),
        categoryId: ref(r.category_id),
        vatRateId: ref(r.vat_rate_id),
        enabled: bool(r.enabled),
        sortOrder: Number(r.sort_order ?? 0),
        timesApplied: Number(r.times_applied ?? 0),
        createdAt: String(r.created_at),
      })),
    );

    await insert(
      schema.recurringInvoices,
      rows<Record<string, any>>("recurring_invoices").map((r) => ({
        id: String(r.id),
        tenantId: tid,
        name: String(r.name ?? ""),
        customerId: String(r.customer_id),
        status: String(r.status ?? "active"),
        frequency: String(r.frequency ?? "monthly"),
        interval: Number(r.interval ?? 1),
        startDate: String(r.start_date),
        nextRunDate: String(r.next_run_date),
        endDate: nz(r.end_date),
        occurrencesLimit: nz(r.occurrences_limit),
        occurrencesCount: Number(r.occurrences_count ?? 0),
        dueDays: Number(r.due_days ?? 30),
        autoSend: bool(r.auto_send),
        notes: nz(r.notes),
        terms: nz(r.terms),
        createdAt: String(r.created_at),
      })),
    );

    await insert(
      schema.recurringInvoiceLines,
      rows<Record<string, any>>("recurring_invoice_lines").map((r) => ({
        id: String(r.id),
        tenantId: tid,
        recurringId: String(r.recurring_id),
        productId: nz(r.product_id),
        description: String(r.description ?? ""),
        quantity: Number(r.quantity ?? 1),
        unitPrice: Number(r.unit_price ?? 0),
        vatRateId: ref(r.vat_rate_id),
        sortOrder: Number(r.sort_order ?? 0),
      })),
    );

    await insert(
      schema.employees,
      rows<Record<string, any>>("employees").map((r) => ({
        id: String(r.id),
        tenantId: tid,
        firstName: String(r.first_name ?? ""),
        familyName: String(r.family_name ?? ""),
        ppsn: nz(r.ppsn),
        employerReference: nz(r.employer_reference),
        employmentId: String(r.employment_id ?? "1"),
        dob: nz(r.dob),
        addressLine1: nz(r.address_line1),
        addressLine2: nz(r.address_line2),
        city: nz(r.city),
        email: nz(r.email),
        startDate: nz(r.start_date),
        dateOfLeaving: nz(r.date_of_leaving),
        director: nz(r.director),
        payFrequency: String(r.pay_frequency ?? "Monthly"),
        standardGross: Number(r.standard_gross ?? 0),
        pensionEmployeePct: Number(r.pension_employee_pct ?? 0),
        prsiClass: nz(r.prsi_class),
        status: String(r.status ?? "active"),
        createdAt: String(r.created_at),
      })),
    );

    await insert(
      schema.rpns,
      rows<Record<string, any>>("rpns").map((r) => ({
        id: String(r.id),
        tenantId: tid,
        employeeId: nz(r.employee_id),
        taxYear: Number(r.tax_year),
        rpnNumber: String(r.rpn_number ?? ""),
        rpnIssueDate: nz(r.rpn_issue_date),
        firstName: nz(r.first_name),
        familyName: nz(r.family_name),
        ppsn: nz(r.ppsn),
        employmentId: nz(r.employment_id),
        employerReference: nz(r.employer_reference),
        incomeTaxBasis: nz(r.income_tax_basis),
        exclusionOrder: bool(r.exclusion_order),
        effectiveDate: nz(r.effective_date),
        endDate: nz(r.end_date),
        payForIncomeTaxToDate: nz(r.pay_for_income_tax_to_date),
        incomeTaxDeductedToDate: nz(r.income_tax_deducted_to_date),
        yearlyTaxCredit: nz(r.yearly_tax_credit),
        taxRate1Pct: nz(r.tax_rate1_pct),
        yearlyRate1CutOff: nz(r.yearly_rate1_cutoff),
        taxRate2Pct: nz(r.tax_rate2_pct),
        prsiExempt: bool(r.prsi_exempt),
        prsiClass: nz(r.prsi_class),
        uscStatus: nz(r.usc_status),
        uscBands: nz(r.usc_bands),
        payForUscToDate: nz(r.pay_for_usc_to_date),
        uscDeductedToDate: nz(r.usc_deducted_to_date),
        lptToDeduct: nz(r.lpt_to_deduct),
        employmentCessationDate: nz(r.employment_cessation_date),
        statePensionContributory: bool(r.state_pension_contributory),
        rawJson: nz(r.raw_json),
        createdAt: String(r.created_at),
      })),
    );

    await insert(
      schema.payRuns,
      rows<Record<string, any>>("pay_runs").map((r) => ({
        id: String(r.id),
        tenantId: tid,
        taxYear: Number(r.tax_year),
        periodNo: Number(r.period_no),
        payDate: String(r.pay_date),
        frequency: String(r.frequency ?? "Monthly"),
        payrollRunReference: String(r.payroll_run_reference),
        status: String(r.status ?? "draft"),
        createdAt: String(r.created_at),
      })),
    );

    await insert(
      schema.payslips,
      rows<Record<string, any>>("payslips").map((r) => ({
        id: String(r.id),
        tenantId: tid,
        payRunId: String(r.pay_run_id),
        employeeId: String(r.employee_id),
        rpnNumber: nz(r.rpn_number),
        incomeTaxBasis: nz(r.income_tax_basis),
        exclusionOrder: bool(r.exclusion_order),
        taxCreditsThisPeriod: nz(r.tax_credits_this_period),
        standardRateCutOff: nz(r.standard_rate_cutoff),
        grossPay: Number(r.gross_pay ?? 0),
        pensionEmployee: Number(r.pension_employee ?? 0),
        pensionEmployer: Number(r.pension_employer ?? 0),
        payForIncomeTax: Number(r.pay_for_income_tax ?? 0),
        incomeTaxPaid: Number(r.income_tax_paid ?? 0),
        payForEmployeePrsi: Number(r.pay_for_employee_prsi ?? 0),
        payForEmployerPrsi: Number(r.pay_for_employer_prsi ?? 0),
        employeePrsi: Number(r.employee_prsi ?? 0),
        employerPrsi: Number(r.employer_prsi ?? 0),
        prsiClass: nz(r.prsi_class),
        insurableWeeks: Number(r.insurable_weeks ?? 4),
        prsiExempt: bool(r.prsi_exempt),
        payForUsc: Number(r.pay_for_usc ?? 0),
        uscStatus: nz(r.usc_status),
        uscPaid: Number(r.usc_paid ?? 0),
        lptDeducted: Number(r.lpt_deducted ?? 0),
        otherDeductions: Number(r.other_deductions ?? 0),
        otherDeductionsLabel: nz(r.other_deductions_label),
        netPay: Number(r.net_pay ?? 0),
        notes: nz(r.notes),
        createdAt: String(r.created_at),
      })),
    );

    // Receipt metadata only. The blobs lived on the desktop's disk and are not
    // reachable from here; a row whose file is missing renders as "unavailable"
    // rather than crashing, and there are none in practice.
    await insert(
      schema.receipts,
      rows<Record<string, any>>("receipts").map((r) => ({
        id: String(r.id),
        tenantId: tid,
        transactionId: String(r.transaction_id),
        fileName: String(r.file_name),
        mimeType: String(r.mime_type),
        size: Number(r.size ?? 0),
        storagePath: String(r.storage_path),
        createdAt: String(r.created_at),
      })),
    );
  });

  // --- reconciliation -------------------------------------------------------
  console.log("\nrow counts");
  let mismatch = false;
  for (const table of TABLES) {
    const before = srcCount(table);
    const [row] = await db
      .select({ n: sql<number>`count(*)` })
      .from(PG_TABLE[table])
      .where(eq(PG_TABLE[table].tenantId, tid));
    const after = Number(row?.n ?? 0);
    const ok = before === after;
    if (!ok) mismatch = true;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${table.padEnd(26)} ${before} -> ${after}`);
  }

  const sums: [string, number, number][] = [];
  const srcSum = (table: string, column: string) =>
    Math.round(
      Number(
        (src.prepare(`SELECT COALESCE(SUM("${column}"),0) s FROM "${table}"`).get() as { s: number })
          .s,
      ) * 100,
    ) / 100;
  const pgSum = async (table: any, column: any) => {
    const [row] = await db
      .select({ s: sql<string>`COALESCE(SUM(${column}), 0)` })
      .from(table)
      .where(eq(table.tenantId, tid));
    return Math.round(Number(row?.s ?? 0) * 100) / 100;
  };

  sums.push(["sum(transactions.amount)", srcSum("transactions", "amount"), await pgSum(schema.transactions, schema.transactions.amount)]);
  sums.push(["sum(invoices.total)", srcSum("invoices", "total"), await pgSum(schema.invoices, schema.invoices.total)]);
  sums.push(["sum(invoices.vat_total)", srcSum("invoices", "vat_total"), await pgSum(schema.invoices, schema.invoices.vatTotal)]);
  sums.push(["sum(invoices.amount_paid)", srcSum("invoices", "amount_paid"), await pgSum(schema.invoices, schema.invoices.amountPaid)]);
  sums.push(["sum(payments.amount)", srcSum("payments", "amount"), await pgSum(schema.payments, schema.payments.amount)]);

  console.log("\nmoney");
  for (const [label, before, after] of sums) {
    const ok = before === after;
    if (!ok) mismatch = true;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${label.padEnd(26)} ${before} -> ${after}`);
  }

  src.close();
  await pool.end();

  if (mismatch) {
    console.error("\nMISMATCH — the import did not reproduce the source. Do not use this tenant.");
    process.exit(1);
  }
  console.log("\nreconciled: every count and every total matches the source.");
}

main().catch(async (error) => {
  console.error("import failed:", error);
  await pool.end().catch(() => {});
  process.exit(1);
});
