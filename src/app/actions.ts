"use server";

import { revalidatePath } from "next/cache";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { boot } from "@/lib/boot";
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

// ---- Statement import -----------------------------------------------------

export async function importStatement(
  formData: FormData,
): Promise<ImportSummary> {
  boot();
  const file = formData.get("file") as File | null;
  if (!file) {
    return { batch: "", parsed: 0, inserted: 0, duplicates: 0, autoCategorized: 0, errors: ["No file provided."] };
  }
  const text = await file.text();
  const { rows, errors } = parseStatementCsv(text);
  const summary = importTransactions(rows, errors);
  revalidatePath("/transactions");
  revalidatePath("/");
  return summary;
}

// ---- Transactions ---------------------------------------------------------

export async function categorizeTx(
  id: string,
  categoryId: string | null,
  vatRateId?: string | null,
) {
  boot();
  // If a category is chosen and no explicit VAT supplied, inherit category default.
  let vat = vatRateId;
  if (categoryId && vatRateId === undefined) {
    const cat = db.select().from(categories).where(eq(categories.id, categoryId)).get();
    vat = cat?.vatApplicable ? (cat.defaultVatRateId ?? null) : null;
  }
  updateTransaction(id, {
    categoryId,
    ...(vat !== undefined ? { vatRateId: vat } : {}),
  });
  revalidatePath("/transactions");
  revalidatePath("/");
}

export async function setTxVat(id: string, vatRateId: string | null) {
  boot();
  updateTransaction(id, { vatRateId });
  revalidatePath("/transactions");
}

export async function setTxNote(id: string, note: string) {
  boot();
  updateTransaction(id, { note });
  revalidatePath("/transactions");
}

export async function bulkCategorizeTx(ids: string[], categoryId: string | null) {
  boot();
  bulkCategorize(ids, categoryId);
  revalidatePath("/transactions");
  revalidatePath("/");
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
  boot();
  if (data.id) {
    db.update(categories)
      .set({
        name: data.name,
        kind: data.kind,
        defaultVatRateId: data.defaultVatRateId,
        vatApplicable: data.vatApplicable,
        color: data.color,
      })
      .where(eq(categories.id, data.id))
      .run();
  } else {
    db.insert(categories)
      .values({ id: uid(), ...data })
      .run();
  }
  revalidatePath("/settings");
  revalidatePath("/transactions");
}

export async function deleteCategory(id: string) {
  boot();
  // unhook any transactions first to avoid orphans
  db.update(transactions).set({ categoryId: null }).where(eq(transactions.categoryId, id)).run();
  db.delete(categories).where(eq(categories.id, id)).run();
  revalidatePath("/settings");
  revalidatePath("/transactions");
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
  boot();
  if (data.id) {
    const { id, ...rest } = data;
    db.update(customers).set(rest).where(eq(customers.id, id)).run();
  } else {
    db.insert(customers).values({ id: uid(), ...data }).run();
  }
  revalidatePath("/customers");
  revalidatePath("/invoices");
}

export async function archiveCustomer(id: string, archived: boolean) {
  boot();
  db.update(customers).set({ archived }).where(eq(customers.id, id)).run();
  revalidatePath("/customers");
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
  boot();
  if (data.id) {
    const { id, ...rest } = data;
    db.update(products).set(rest).where(eq(products.id, id)).run();
  } else {
    db.insert(products).values({ id: uid(), ...data }).run();
  }
  revalidatePath("/products");
  revalidatePath("/invoices");
}

export async function archiveProduct(id: string, archived: boolean) {
  boot();
  db.update(products).set({ archived }).where(eq(products.id, id)).run();
  revalidatePath("/products");
}

// ---- Invoices -------------------------------------------------------------

export async function saveInvoice(input: InvoiceInput & { id?: string }) {
  boot();
  const result = input.id
    ? updateInvoice(input.id, input)
    : createInvoice(input);
  revalidatePath("/invoices");
  revalidatePath("/");
  return result;
}

export async function deleteInvoiceAction(id: string) {
  boot();
  delInvoice(id);
  revalidatePath("/invoices");
  revalidatePath("/");
}

export async function addPayment(
  invoiceId: string,
  data: { date: string; amount: number; method?: string; transactionId?: string | null; note?: string },
) {
  boot();
  recordPayment(invoiceId, data);
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/vat");
  revalidatePath("/");
}

export async function removePayment(invoiceId: string, paymentId: string) {
  boot();
  delPayment(paymentId);
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/vat");
}

export async function changeInvoiceStatus(id: string, status: string) {
  boot();
  setInvoiceStatus(id, status);
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${id}`);
}

// ---- Recurring invoices ---------------------------------------------------

export async function saveRecurringAction(input: RecurringInput) {
  boot();
  const result = saveRecurring(input);
  revalidatePath("/invoices");
  revalidatePath("/invoices/recurring");
  return result;
}

export async function setRecurringStatusAction(id: string, status: "active" | "paused") {
  boot();
  setRecurringStatus(id, status);
  revalidatePath("/invoices");
}

export async function deleteRecurringAction(id: string) {
  boot();
  deleteRecurring(id);
  revalidatePath("/invoices");
}

export async function generateDueInvoices() {
  boot();
  const result = generateDue();
  revalidatePath("/invoices");
  revalidatePath("/");
  return result;
}

// ---- Receipts -------------------------------------------------------------

export async function uploadReceipt(formData: FormData) {
  boot();
  const transactionId = String(formData.get("transactionId") ?? "");
  const file = formData.get("file") as File | null;
  if (!transactionId || !file) return { ok: false, error: "Missing file." };
  if (file.size > 15 * 1024 * 1024) return { ok: false, error: "Max 15 MB." };
  if (file.type && !ALLOWED_MIME.includes(file.type)) {
    return { ok: false, error: "Only images and PDFs are accepted." };
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  await saveReceipt(transactionId, { name: file.name, type: file.type, bytes });
  revalidatePath("/transactions");
  return { ok: true };
}

export async function deleteReceiptAction(id: string) {
  boot();
  deleteReceipt(id);
  revalidatePath("/transactions");
}

// ---- Categorisation rules -------------------------------------------------

export async function saveRuleAction(input: RuleInput) {
  boot();
  saveRule(input);
  revalidatePath("/rules");
}

export async function deleteRuleAction(id: string) {
  boot();
  deleteRule(id);
  revalidatePath("/rules");
}

export async function reorderRuleAction(id: string, direction: "up" | "down") {
  boot();
  reorderRule(id, direction);
  revalidatePath("/rules");
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
  boot();
  const result = applyRulesToAll();
  revalidatePath("/transactions");
  revalidatePath("/rules");
  revalidatePath("/reports");
  revalidatePath("/vat");
  revalidatePath("/");
  return result;
}

/**
 * Takes transactions out of the books, or puts them back. The row stays either way, so a
 * statement still reconciles line for line and the call can be reversed.
 */
export async function setExcludedAction(ids: string[], excluded: boolean, reason = "") {
  boot();
  const result = setExcluded(ids, excluded, reason);
  revalidatePath("/transactions");
  revalidatePath("/reports");
  revalidatePath("/vat");
  revalidatePath("/invoices");
  revalidatePath("/");
  return result;
}

// ---- Payroll --------------------------------------------------------------

export async function saveEmployeeAction(input: EmployeeInput) {
  boot();
  const id = saveEmployee(input);
  revalidatePath("/payroll/employees");
  revalidatePath("/payroll");
  return id;
}

export async function setEmployeeStatusAction(
  id: string,
  status: "active" | "leaver",
  dateOfLeaving?: string | null,
) {
  boot();
  setEmployeeStatus(id, status, dateOfLeaving);
  revalidatePath("/payroll/employees");
}

export async function importRpnAction(formData: FormData) {
  boot();
  const file = formData.get("file") as File | null;
  const taxYear = Number(formData.get("taxYear")) || new Date().getFullYear();
  if (!file) return { parsed: 0, imported: 0, matched: 0, unmatched: 0, errors: ["No file provided."] };
  const text = await file.text();
  const summary = importRpnJson(text, taxYear);
  revalidatePath("/payroll/rpns");
  revalidatePath("/payroll");
  return summary;
}

export async function createPayRunAction(taxYear: number, periodNo: number, payDate: string) {
  boot();
  const id = createPayRun(taxYear, periodNo, payDate);
  revalidatePath("/payroll");
  revalidatePath("/payroll/runs");
  return id;
}

export async function updatePayslipAction(id: string, patch: Partial<Payslip>) {
  boot();
  updatePayslip(id, patch);
  revalidatePath("/payroll");
}

export async function recomputePayslipAction(id: string) {
  boot();
  recomputePayslip(id);
  revalidatePath("/payroll");
}

export async function setPayRunStatusAction(id: string, status: "draft" | "finalised") {
  boot();
  setPayRunStatus(id, status);
  revalidatePath("/payroll");
  revalidatePath("/payroll/runs");
}

export async function deletePayRunAction(id: string) {
  boot();
  deletePayRun(id);
  revalidatePath("/payroll");
  revalidatePath("/payroll/runs");
}

// ---- Settings -------------------------------------------------------------

export async function saveSettings(data: Partial<typeof settings.$inferInsert>) {
  boot();
  db.update(settings).set(data).where(eq(settings.id, 1)).run();
  revalidatePath("/settings");
  revalidatePath("/invoices");
}
