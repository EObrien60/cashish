"use server";

import { setBudget, copyBudget, suggestBudget } from "@/lib/budgets";
import { generateReport } from "@/lib/ai-report";
import { proposeRulesForAccount, accountsNeedingRules } from "@/lib/ai-rules";
import {
  saveDocument,
  extractDocument,
  confirmAsBill,
  linkToTransaction,
  candidateTransactions,
  rejectDocument,
  deleteDocument,
} from "@/lib/documents";
import {
  updateAccount,
  assignUnassigned,
  ensureAccount,
  getAccount,
  mergeAccounts,
} from "@/lib/accounts";
import { detectTransfers, pairTransfers, markTransfer, unmarkTransfer } from "@/lib/transfers";
import type { AccountKind } from "@cashish/core/db";
import {
  saveContract,
  setContractStatus,
  deleteContract,
  attachDocument,
  type ContractInput,
  type ContractStatus,
} from "@/lib/contracts";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, first, schema, tenantId, type Payslip } from "@cashish/core/db";
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
  sendInvoiceEmail,
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
  acceptRule,
  RulePostingError,
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
import { createPerson, setTransactionEmployee, setPersonStatus } from "@/lib/people";
import {
  createVendor,
  updateVendor,
  setVendorArchived,
  setTransactionVendor,
} from "@/lib/vendors";
import {
  createBill,
  postBillToTransaction,
  recordBillPayment,
  setBillStatus,
  deleteBill,
  ALLOWED_BILL_MIME,
} from "@/lib/bills";

const { categories, customers, products, settings, transactions } = schema;

// ---------------------------------------------------------------------------
// Server actions.
//
// Every action is wrapped in withCapability(), which does three things at once:
// verifies the session, checks the caller's role against the capability map in
// @cashish/core/rbac, and establishes the tenant context that src/lib/* queries
// scope themselves by. The old boot() call is gone — there is no schema to
// apply at request time any more.
//
// An action that forgets the wrapper does not silently operate on every tenant:
// @cashish/core/db throws when no tenant is in scope.
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
  // Which account this statement is for.
  //
  // Most Revolut exports name it in the file, but the savings one does not: it
  // has a Date, a Description and a Value, and nothing that says which account
  // produced it. Without being told, every such statement would land on
  // whatever the fallback is — silently, and wrongly.
  const accountId = String(formData.get("accountId") ?? "").trim();
  const newAccountName = String(formData.get("newAccountName") ?? "").trim();
  const newAccountKind = String(formData.get("newAccountKind") ?? "").trim();

  return withCapability("books:import", async () => {
    let fallbackAccount: string | undefined;

    if (newAccountName) {
      await ensureAccount({
        name: newAccountName,
        kind: (newAccountKind || undefined) as AccountKind | undefined,
        inferred: false,
      });
      fallbackAccount = newAccountName;
    } else if (accountId) {
      const chosen = await getAccount(accountId);
      if (!chosen) {
        return {
          batch: "",
          parsed: 0,
          inserted: 0,
          duplicates: 0,
          autoCategorized: 0,
          errors: ["That account no longer exists."],
        };
      }
      // Choosing an existing account is also a statement that it is real, not
      // a guess made from the far side of somebody else's transfer.
      await ensureAccount({ name: chosen.name, inferred: false });
      fallbackAccount = chosen.name;
    }

    const { rows, errors } = parseStatementCsv(text);
    const summary = await importTransactions(rows, errors, { fallbackAccount });
    revalidatePath("/transactions");
    revalidatePath("/accounts");
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

/** Errors here (no customer email, platform email not configured) are meant for the UI to show as-is. */
export async function sendInvoiceEmailAction(id: string) {
  return withCapability("books:write", async () => {
    await sendInvoiceEmail(id);
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

export async function saveRuleAction(
  input: RuleInput,
): Promise<{ ok?: boolean; error?: string }> {
  return withCapability("books:write", async () => {
    try {
      await saveRule(input);
    } catch (e) {
      // A rule contradicting its own posting kind is a form error, not a crash:
      // the person typing needs to be told which field is missing.
      if (e instanceof RulePostingError) return { error: e.message };
      throw e;
    }
    revalidatePath("/rules");
    revalidatePath("/transactions");
    return { ok: true };
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

// --- Documents --------------------------------------------------------------

/**
 * Upload and read, in one go.
 *
 * books:import rather than books:write — this is the same act as importing a
 * statement, and it still writes nothing to the books. Every document lands as
 * a proposal.
 */
export async function uploadDocumentsAction(formData: FormData) {
  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return { error: "Choose at least one file." };

  const prepared: { name: string; type: string; bytes: Buffer }[] = [];
  for (const file of files) {
    prepared.push({
      name: file.name,
      type: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
  }

  return withCapability("books:import", async () => {
    const results: { id: string; fileName: string; ok: boolean; reason?: string }[] = [];
    for (const file of prepared) {
      const id = await saveDocument(file);
      const read = await extractDocument(id);
      results.push({
        id,
        fileName: file.name,
        ok: read.ok,
        ...(read.ok ? {} : { reason: read.reason }),
      });
    }
    revalidatePath("/documents");
    return { results };
  });
}

export async function rereadDocumentAction(id: string) {
  return withCapability("books:import", async () => {
    const r = await extractDocument(id);
    revalidatePath("/documents");
    return r;
  });
}

export async function confirmDocumentAsBillAction(
  id: string,
  input: {
    vendorName: string;
    number?: string;
    issueDate: string;
    dueDate?: string | null;
    net: number;
    vatTotal: number;
    paidByTransactionId?: string | null;
  },
) {
  return withCapability("books:write", async () => {
    const result = await confirmAsBill(id, input);
    revalidatePath("/documents");
    revalidatePath("/vendors");
    return result;
  });
}

export async function attachDocumentToTransactionAction(id: string, transactionId: string) {
  return withCapability("books:write", async () => {
    await linkToTransaction(id, transactionId);
    revalidatePath("/documents");
    revalidatePath("/transactions");
  });
}

export async function candidateTransactionsAction(id: string) {
  return withCapability("books:read", async () => candidateTransactions(id));
}

export async function rejectDocumentAction(id: string) {
  return withCapability("books:write", async () => {
    await rejectDocument(id);
    revalidatePath("/documents");
  });
}

export async function deleteDocumentAction(id: string) {
  return withCapability("books:write", async () => {
    await deleteDocument(id);
    revalidatePath("/documents");
  });
}

// --- AI ---------------------------------------------------------------------

export async function generateReportAction(from: string, to: string) {
  // books:read, not write: a report changes nothing. The capability check is
  // still here so a signed-out request cannot spend tokens.
  return withCapability("books:read", async () => generateReport({ from, to }));
}

export async function proposeRulesAction(accountId: string | null) {
  return withCapability("books:read", async () => proposeRulesForAccount({ accountId }));
}

export async function accountsNeedingRulesAction() {
  return withCapability("books:read", async () => accountsNeedingRules());
}

/**
 * Accepting a proposal. Note what this does NOT do: the model's suggestion is
 * not stored anywhere and has no privileged path. It arrives back here as an
 * ordinary rule and goes through the ordinary saveRule, dry-run count and all.
 */
export async function acceptProposedRuleAction(input: {
  name: string;
  matchValue: string;
  direction: "in" | "out" | "any";
  categoryId: string;
}) {
  return withCapability("books:write", async () => {
    const applied = await acceptRule(input);
    revalidatePath("/rules");
    revalidatePath("/transactions");
    revalidatePath("/insights");
    return applied;
  });
}

// --- Contracts --------------------------------------------------------------

export async function saveContractAction(input: ContractInput) {
  return withCapability("books:write", async () => {
    const id = await saveContract(input);
    revalidatePath("/contracts");
    revalidatePath("/invoices");
    return { id };
  });
}

export async function setContractStatusAction(id: string, status: ContractStatus) {
  return withCapability("books:write", async () => {
    await setContractStatus(id, status);
    revalidatePath("/contracts");
  });
}

export async function deleteContractAction(id: string) {
  return withCapability("books:write", async () => {
    await deleteContract(id);
    revalidatePath("/contracts");
  });
}

export async function attachContractDocumentAction(formData: FormData) {
  const id = String(formData.get("contractId") ?? "");
  const file = formData.get("file") as File | null;
  if (!id || !file) return { error: "Choose a file." };
  const bytes = Buffer.from(await file.arrayBuffer());
  return withCapability("books:write", async () => {
    await attachDocument(id, { name: file.name, type: file.type, bytes });
    revalidatePath("/contracts");
    return { ok: true };
  });
}

// --- Accounts ---------------------------------------------------------------

export async function updateAccountAction(
  id: string,
  patch: { name?: string; kind?: AccountKind; currency?: string; openingBalance?: number; archived?: boolean },
) {
  return withCapability("books:write", async () => {
    await updateAccount(id, patch);
    revalidatePath("/accounts");
    revalidatePath("/transactions");
  });
}

export async function mergeAccountsAction(fromId: string, intoId: string) {
  return withCapability("books:write", async () => {
    const result = await mergeAccounts(fromId, intoId);
    // The far side of a transfer may now be reachable, so try pairing again.
    await pairTransfers();
    revalidatePath("/accounts");
    revalidatePath("/transactions");
    return result;
  });
}

export async function assignUnassignedAction(accountId: string) {
  return withCapability("books:write", async () => {
    const n = await assignUnassigned(accountId);
    revalidatePath("/accounts");
    revalidatePath("/transactions");
    return n;
  });
}

/**
 * Rebuilds accounts and transfers from transactions already in the book.
 *
 * Everything imported before accounts existed sits on no account and has never
 * been looked at for transfers. This is the one action that fixes that, and it
 * is deliberately one action rather than three buttons: on an existing book the
 * three steps are meaningless apart — an account to assign to, the assigning,
 * and then the transfer scan that can only work once rows know where they sat.
 *
 * Safe to run repeatedly. Assigning only touches rows with no account,
 * detection skips anything already classified, and pairing skips anything
 * already paired.
 */
export async function recomputeAccountsAction(input: { createAccount?: string } = {}) {
  return withCapability("books:write", async () => {
    let assigned = 0;
    const name = input.createAccount?.trim();
    if (name) {
      const { id } = await ensureAccount({ name, inferred: false });
      assigned = await assignUnassigned(id);
    }
    const detected = await detectTransfers();
    const paired = await pairTransfers();
    revalidatePath("/accounts");
    revalidatePath("/transactions");
    return {
      assigned,
      detected: detected.detected,
      paired,
      accountsCreated: detected.accountsCreated,
    };
  });
}

export async function markTransferAction(id: string, counterpartAccountId: string) {
  return withCapability("books:write", async () => {
    await markTransfer(id, counterpartAccountId);
    await pairTransfers();
    revalidatePath("/transactions");
  });
}

export async function unmarkTransferAction(id: string) {
  return withCapability("books:write", async () => {
    await unmarkTransfer(id);
    revalidatePath("/transactions");
  });
}

// --- Budgets (personal books) ----------------------------------------------

export async function setBudgetAction(categoryId: string, month: string, amount: number) {
  return withCapability("books:write", async () => {
    await setBudget({ categoryId, month, amount });
    revalidatePath("/budget");
  });
}

export async function copyBudgetAction(from: string, to: string) {
  return withCapability("books:write", async () => {
    const copied = await copyBudget(from, to);
    revalidatePath("/budget");
    return copied;
  });
}

export async function suggestBudgetAction(month: string) {
  return withCapability("books:write", async () => {
    const written = await suggestBudget(month);
    revalidatePath("/budget");
    return written;
  });
}

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

// ---- People ----------------------------------------------------------------
// Employees, and which bank payments went to them. Deliberately reachable
// without an RPN import or a pay run — see src/lib/people.ts.

export async function createPersonAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const startDate = String(formData.get("startDate") ?? "").trim();
  const grossRaw = String(formData.get("standardGross") ?? "").trim();
  if (!name) return { error: "A name is required." };

  return withCapability("books:write", async () => {
    const { employee, created } = await createPerson({
      name,
      email,
      startDate: startDate || null,
      standardGross: grossRaw ? Number(grossRaw) : 0,
    });
    revalidatePath("/payroll/employees");
    revalidatePath("/payroll");
    revalidatePath("/transactions");
    return { id: employee.id, created };
  });
}

export async function setTxEmployeeAction(ids: string[], employeeId: string | null) {
  return withCapability("books:write", async () => {
    const result = await setTransactionEmployee(ids, employeeId);
    revalidatePath("/transactions");
    revalidatePath("/payroll/employees");
    return result;
  });
}

export async function setPersonStatusAction(id: string, status: "active" | "leaver") {
  return withCapability("books:write", async () => {
    await setPersonStatus(id, status);
    revalidatePath("/payroll/employees");
  });
}

// ---- Vendors and bills -----------------------------------------------------

export async function saveVendor(data: {
  id?: string;
  name: string;
  email?: string;
  vatNumber?: string;
  addressLine1?: string;
  city?: string;
  country?: string;
  defaultCategoryId?: string | null;
  notes?: string;
}) {
  return withCapability("books:write", async () => {
    if (!data.name?.trim()) return { error: "A name is required." };
    if (data.id) {
      const { id, ...rest } = data;
      await updateVendor(id, rest);
      revalidatePath(`/vendors/${id}`);
    } else {
      const { created } = await createVendor(data);
      if (!created) return { error: "There is already a vendor with that name." };
    }
    revalidatePath("/vendors");
    return { ok: true };
  });
}

export async function archiveVendorAction(id: string, archived: boolean) {
  return withCapability("books:write", async () => {
    await setVendorArchived(id, archived);
    revalidatePath("/vendors");
    revalidatePath(`/vendors/${id}`);
  });
}

export async function setTxVendorAction(ids: string[], vendorId: string | null) {
  return withCapability("books:write", async () => {
    const result = await setTransactionVendor(ids, vendorId);
    revalidatePath("/transactions");
    revalidatePath("/vendors");
    return result;
  });
}

/**
 * Records a bill, optionally with the document attached and optionally posted
 * straight against the bank line that paid it.
 *
 * The file is read out of the FormData before the capability wrapper, because a
 * File cannot be carried across that boundary.
 */
export async function createBillAction(formData: FormData) {
  const vendorId = String(formData.get("vendorId") ?? "");
  const number = String(formData.get("number") ?? "");
  const issueDate = String(formData.get("issueDate") ?? "");
  const dueDate = String(formData.get("dueDate") ?? "");
  const net = Number(formData.get("net") ?? 0);
  const vatTotal = Number(formData.get("vatTotal") ?? 0);
  const categoryId = String(formData.get("categoryId") ?? "");
  const vatRateId = String(formData.get("vatRateId") ?? "");
  const notes = String(formData.get("notes") ?? "");
  const paidBy = String(formData.get("paidByTransactionId") ?? "");
  const file = formData.get("file") as File | null;

  if (!vendorId) return { error: "Which vendor is this from?" };
  if (!issueDate) return { error: "The bill needs a date." };
  if (!Number.isFinite(net) || net <= 0) return { error: "Enter the net amount." };
  if (!Number.isFinite(vatTotal) || vatTotal < 0) return { error: "VAT cannot be negative." };

  let payload: { name: string; type: string; bytes: Buffer } | null = null;
  if (file && file.size > 0) {
    if (file.size > 15 * 1024 * 1024) return { error: "Max 15 MB." };
    if (file.type && !ALLOWED_BILL_MIME.includes(file.type)) {
      return { error: "Attach a PDF or an image." };
    }
    payload = {
      name: file.name,
      type: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    };
  }

  return withCapability("books:write", async () => {
    try {
      const bill = await createBill({
        vendorId,
        number,
        issueDate,
        dueDate: dueDate || null,
        net,
        vatTotal,
        categoryId: categoryId || null,
        vatRateId: vatRateId || null,
        notes,
        file: payload,
        paidByTransactionId: paidBy || null,
      });
      revalidatePath(`/vendors/${vendorId}`);
      revalidatePath("/vendors");
      revalidatePath("/transactions");
      return { ok: true, id: bill?.id };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Could not save that bill." };
    }
  });
}

export async function postBillToTransactionAction(billId: string, transactionId: string) {
  return withCapability("books:write", async () => {
    try {
      const bill = await postBillToTransaction(billId, transactionId);
      revalidatePath("/vendors");
      if (bill) revalidatePath(`/vendors/${bill.vendorId}`);
      revalidatePath("/transactions");
      return { ok: true };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Could not post that payment." };
    }
  });
}

export async function recordBillPaymentAction(
  billId: string,
  data: { date: string; amount: number; note?: string },
) {
  return withCapability("books:write", async () => {
    const bill = await recordBillPayment(billId, data);
    revalidatePath("/vendors");
    if (bill) revalidatePath(`/vendors/${bill.vendorId}`);
    return { ok: true };
  });
}

export async function setBillStatusAction(id: string, status: "awaiting" | "void") {
  return withCapability("books:write", async () => {
    const bill = await setBillStatus(id, status);
    revalidatePath("/vendors");
    if (bill) revalidatePath(`/vendors/${bill.vendorId}`);
  });
}

export async function deleteBillAction(id: string, vendorId: string) {
  return withCapability("books:write", async () => {
    await deleteBill(id);
    revalidatePath("/vendors");
    revalidatePath(`/vendors/${vendorId}`);
  });
}
