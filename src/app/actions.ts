"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, first, schema } from "@/db/client";
import { tenantId } from "@/db/context";
import { withCapability } from "@/lib/request-context";
import { uid } from "@/lib/id";
import { parseStatementCsv } from "@/lib/import";
import {
  importTransactions,
  updateTransaction,
  bulkCategorize,
  setExcluded,
  type ImportSummary,
} from "@/lib/transactions";
import {
  createInvoice,
  updateInvoice,
  deleteInvoice as delInvoice,
  recordPayment,
  deletePayment as delPayment,
  setInvoiceStatus,
  type InvoiceInput,
} from "@/lib/invoices";
import {
  saveRecurring,
  setRecurringStatus,
  deleteRecurring,
  generateDue,
  type RecurringInput,
} from "@/lib/recurring";
import { saveReceipt, deleteReceipt, ALLOWED_MIME } from "@/lib/receipts";
import {
  saveRule,
  deleteRule,
  reorderRule,
  applyRulesToAll,
  type RuleInput,
} from "@/lib/rules";
import {
  saveEmployee,
  setEmployeeStatus,
  createPayRun,
  updatePayslip,
  recomputePayslip,
  setPayRunStatus,
  deletePayRun,
  type EmployeeInput,
} from "@/lib/payroll";
import { importRpnJson } from "@/lib/rpn-import";
import type { Payslip } from "@/db/schema";

const { categories, customers, products, settings, transactions } = schema;

// ---------------------------------------------------------------------------
// Server actions.
//
// Every action is wrapped in withCapability(), which does three things at once:
// verifies the session, checks the caller's role against the capability map in
// src/lib/rbac.ts, and establishes the tenant context that src/lib/* queries
// scope themselves by. The old boot() call is gone — there is no schema to
// apply at request time any more.
//
// An action that forgets the wrapper does not silently operate on every tenant:
// src/db/context.ts throws when no tenant is in scope.
// ---------------------------------------------------------------------------

// ---- Statement import -----------------------------------------------------

export async function importStatement(formData: FormData): Promise<ImportSummary> {
  const file = formData.get("file") as File | null;
  if (!file) {
    return {
      batch: "",
      parsed: 0,
      inserted: 0,
      duplicates: 0,
      autoCategorized: 0,
      errors: ["No file provided."],
    };
  }
  const text = await file.text();
  return withCapability("books:import", async () => {
    const { rows, errors } = parseStatementCsv(text);
    const summary = await importTransactions(rows, errors);
    revalidatePath("/transactions");
    revalidatePath("/");
    return summary;
  });
}

// ---- Transactions ---------------------------------------------------------

export async function categorizeTx(
  id: string,
  categoryId: string | null,
  vatRateId?: string | null,
) {
  return withCapability("books:write", async () => {
    // If a category is chosen and no explicit VAT supplied, inherit category default.
    let vat = vatRateId;
    if (categoryId && vatRateId === undefined) {
      const cat = first(
        await db
          .select()
          .from(categories)
          .where(and(eq(categories.tenantId, tenantId()), eq(categories.id, categoryId)))
          .limit(1),
      );
      vat = cat?.vatApplicable ? (cat.defaultVatRateId ?? null) : null;
    }
    await updateTransaction(id, {
      categoryId,
      ...(vat !== undefined ? { vatRateId: vat } : {}),
    });
    revalidatePath("/transactions");
    revalidatePath("/");
  });
}

export async function setTxVat(id: string, vatRateId: string | null) {
  return withCapability("books:write", async () => {
    await updateTransaction(id, { vatRateId });
    revalidatePath("/transactions");
  });
}

export async function setTxNote(id: string, note: string) {
  return withCapability("books:write", async () => {
    await updateTransaction(id, { note });
    revalidatePath("/transactions");
  });
}

export async function bulkCategorizeTx(ids: string[], categoryId: string | null) {
  return withCapability("books:write", async () => {
    await bulkCategorize(ids, categoryId);
    revalidatePath("/transactions");
    revalidatePath("/");
  });
}

// ---- Categories -----------------------------------------------------------

export async function saveCategory(data: {
  id?: string;
  name: string;
  kind: string;
  defaultVatRateId: string | null;
  vatApplicable: boolean;
  color: string;
}) {
  return withCapability("books:write", async () => {
    const tid = tenantId();
    if (data.id) {
      await db
        .update(categories)
        .set({
          name: data.name,
          kind: data.kind,
          defaultVatRateId: data.defaultVatRateId,
          vatApplicable: data.vatApplicable,
          color: data.color,
        })
        .where(and(eq(categories.tenantId, tid), eq(categories.id, data.id)));
    } else {
      const { id: _ignore, ...rest } = data;
      await db.insert(categories).values({ id: uid(), tenantId: tid, ...rest });
    }
    revalidatePath("/settings");
    revalidatePath("/transactions");
  });
}

export async function deleteCategory(id: string) {
  return withCapability("books:write", async () => {
    const tid = tenantId();
    // Unhook transactions first. The FK is ON DELETE SET NULL so this is belt and
    // braces, but doing it explicitly keeps the intent readable.
    await db
      .update(transactions)
      .set({ categoryId: null })
      .where(and(eq(transactions.tenantId, tid), eq(transactions.categoryId, id)));
    await db.delete(categories).where(and(eq(categories.tenantId, tid), eq(categories.id, id)));
    revalidatePath("/settings");
    revalidatePath("/transactions");
  });
}

// ---- Customers ------------------------------------------------------------

export async function saveCustomer(data: {
  id?: string;
  name: string;
  email: string;
  vatNumber: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  country: string;
  notes: string;
}) {
  return withCapability("books:write", async () => {
    const tid = tenantId();
    if (data.id) {
      const { id, ...rest } = data;
      await db
        .update(customers)
        .set(rest)
        .where(and(eq(customers.tenantId, tid), eq(customers.id, id)));
    } else {
      const { id: _ignore, ...rest } = data;
      await db.insert(customers).values({ id: uid(), tenantId: tid, ...rest });
    }
    revalidatePath("/customers");
    revalidatePath("/invoices");
  });
}

export async function archiveCustomer(id: string, archived: boolean) {
  return withCapability("books:write", async () => {
    await db
      .update(customers)
      .set({ archived })
      .where(and(eq(customers.tenantId, tenantId()), eq(customers.id, id)));
    revalidatePath("/customers");
  });
}

// ---- Products -------------------------------------------------------------

export async function saveProduct(data: {
  id?: string;
  name: string;
  description: string;
  unitPrice: number;
  vatRateId: string | null;
  kind: string;
  incomeCategoryId: string | null;
  sku: string;
}) {
  return withCapability("books:write", async () => {
    const tid = tenantId();
    if (data.id) {
      const { id, ...rest } = data;
      await db
        .update(products)
        .set(rest)
        .where(and(eq(products.tenantId, tid), eq(products.id, id)));
    } else {
      const { id: _ignore, ...rest } = data;
      await db.insert(products).values({ id: uid(), tenantId: tid, ...rest });
    }
    revalidatePath("/products");
    revalidatePath("/invoices");
  });
}

export async function archiveProduct(id: string, archived: boolean) {
  return withCapability("books:write", async () => {
    await db
      .update(products)
      .set({ archived })
      .where(and(eq(products.tenantId, tenantId()), eq(products.id, id)));
    revalidatePath("/products");
  });
}

// ---- Invoices -------------------------------------------------------------

export async function saveInvoice(input: InvoiceInput & { id?: string }) {
  return withCapability("books:write", async () => {
    const result = input.id ? await updateInvoice(input.id, input) : await createInvoice(input);
    revalidatePath("/invoices");
    revalidatePath("/");
    return result;
  });
}

export async function deleteInvoiceAction(id: string) {
  return withCapability("books:write", async () => {
    await delInvoice(id);
    revalidatePath("/invoices");
    revalidatePath("/");
  });
}

export async function addPayment(
  invoiceId: string,
  data: {
    date: string;
    amount: number;
    method?: string;
    transactionId?: string | null;
    note?: string;
  },
) {
  return withCapability("books:write", async () => {
    await recordPayment(invoiceId, data);
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath("/vat");
    revalidatePath("/");
  });
}

export async function removePayment(invoiceId: string, paymentId: string) {
  return withCapability("books:write", async () => {
    await delPayment(paymentId);
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath("/vat");
  });
}

export async function changeInvoiceStatus(id: string, status: string) {
  return withCapability("books:write", async () => {
    await setInvoiceStatus(id, status);
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${id}`);
  });
}

// ---- Recurring invoices ---------------------------------------------------

export async function saveRecurringAction(input: RecurringInput) {
  return withCapability("books:write", async () => {
    const result = await saveRecurring(input);
    revalidatePath("/invoices");
    revalidatePath("/invoices/recurring");
    return result;
  });
}

export async function setRecurringStatusAction(id: string, status: "active" | "paused") {
  return withCapability("books:write", async () => {
    await setRecurringStatus(id, status);
    revalidatePath("/invoices");
  });
}

export async function deleteRecurringAction(id: string) {
  return withCapability("books:write", async () => {
    await deleteRecurring(id);
    revalidatePath("/invoices");
  });
}

export async function generateDueInvoices() {
  return withCapability("books:write", async () => {
    const result = await generateDue();
    revalidatePath("/invoices");
    revalidatePath("/");
    return result;
  });
}

// ---- Receipts -------------------------------------------------------------

export async function uploadReceipt(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const transactionId = String(formData.get("transactionId") ?? "");
  const file = formData.get("file") as File | null;
  if (!transactionId || !file) return { ok: false, error: "Missing file." };
  if (file.size > 15 * 1024 * 1024) return { ok: false, error: "Max 15 MB." };
  if (file.type && !ALLOWED_MIME.includes(file.type)) {
    return { ok: false, error: "Only images and PDFs are accepted." };
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  return withCapability("books:write", async () => {
    await saveReceipt(transactionId, { name: file.name, type: file.type, bytes });
    revalidatePath("/transactions");
    return { ok: true };
  });
}

export async function deleteReceiptAction(id: string) {
  return withCapability("books:write", async () => {
    await deleteReceipt(id);
    revalidatePath("/transactions");
  });
}

// ---- Categorisation rules -------------------------------------------------

export async function saveRuleAction(input: RuleInput) {
  return withCapability("books:write", async () => {
    await saveRule(input);
    revalidatePath("/rules");
  });
}

export async function deleteRuleAction(id: string) {
  return withCapability("books:write", async () => {
    await deleteRule(id);
    revalidatePath("/rules");
  });
}

export async function reorderRuleAction(id: string, direction: "up" | "down") {
  return withCapability("books:write", async () => {
    await reorderRule(id, direction);
    revalidatePath("/rules");
  });
}

/**
 * Re-applies every enabled rule across the whole ledger, not only the uncategorised part.
 *
 * A rule you have just corrected is useless if applying it cannot reach the transactions
 * it previously got wrong, which is the whole reason to edit a rule. Transactions no rule
 * matches keep whatever category they have, so categorising something by hand that no
 * rule covers is still safe.
 */
export async function applyRulesAction() {
  return withCapability("books:write", async () => {
    const result = await applyRulesToAll();
    revalidatePath("/transactions");
    revalidatePath("/rules");
    revalidatePath("/reports");
    revalidatePath("/vat");
    revalidatePath("/");
    return result;
  });
}

/**
 * Takes transactions out of the books, or puts them back. The row stays either way, so a
 * statement still reconciles line for line and the call can be reversed.
 */
export async function setExcludedAction(ids: string[], excluded: boolean, reason = "") {
  return withCapability("books:write", async () => {
    const result = await setExcluded(ids, excluded, reason);
    revalidatePath("/transactions");
    revalidatePath("/reports");
    revalidatePath("/vat");
    revalidatePath("/invoices");
    revalidatePath("/");
    return result;
  });
}

// ---- Payroll --------------------------------------------------------------

export async function saveEmployeeAction(input: EmployeeInput) {
  return withCapability("books:write", async () => {
    const id = await saveEmployee(input);
    revalidatePath("/payroll/employees");
    revalidatePath("/payroll");
    return id;
  });
}

export async function setEmployeeStatusAction(
  id: string,
  status: "active" | "leaver",
  dateOfLeaving?: string | null,
) {
  return withCapability("books:write", async () => {
    await setEmployeeStatus(id, status, dateOfLeaving);
    revalidatePath("/payroll/employees");
  });
}

export async function importRpnAction(formData: FormData) {
  const file = formData.get("file") as File | null;
  const taxYear = Number(formData.get("taxYear")) || new Date().getFullYear();
  if (!file) {
    return { parsed: 0, imported: 0, matched: 0, unmatched: 0, errors: ["No file provided."] };
  }
  const text = await file.text();
  return withCapability("books:import", async () => {
    const summary = await importRpnJson(text, taxYear);
    revalidatePath("/payroll/rpns");
    revalidatePath("/payroll");
    return summary;
  });
}

export async function createPayRunAction(taxYear: number, periodNo: number, payDate: string) {
  return withCapability("books:write", async () => {
    const id = await createPayRun(taxYear, periodNo, payDate);
    revalidatePath("/payroll");
    revalidatePath("/payroll/runs");
    return id;
  });
}

export async function updatePayslipAction(id: string, patch: Partial<Payslip>) {
  return withCapability("books:write", async () => {
    await updatePayslip(id, patch);
    revalidatePath("/payroll");
  });
}

export async function recomputePayslipAction(id: string) {
  return withCapability("books:write", async () => {
    await recomputePayslip(id);
    revalidatePath("/payroll");
  });
}

export async function setPayRunStatusAction(id: string, status: "draft" | "finalised") {
  return withCapability("books:write", async () => {
    await setPayRunStatus(id, status);
    revalidatePath("/payroll");
    revalidatePath("/payroll/runs");
  });
}

export async function deletePayRunAction(id: string) {
  return withCapability("books:write", async () => {
    await deletePayRun(id);
    revalidatePath("/payroll");
    revalidatePath("/payroll/runs");
  });
}

// ---- Settings -------------------------------------------------------------

export async function saveSettings(data: Partial<typeof settings.$inferInsert>) {
  return withCapability("settings:write", async () => {
    // tenantId is stripped: the row to update is decided by the session, never
    // by the payload, so a crafted form cannot write another tenant's settings.
    const { tenantId: _ignore, ...rest } = data;
    await db.update(settings).set(rest).where(eq(settings.tenantId, tenantId()));
    revalidatePath("/settings");
    revalidatePath("/invoices");
  });
}
