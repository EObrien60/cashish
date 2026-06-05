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

const { categories, customers, products, settings, transactions } = schema;

// ---- Statement import -----------------------------------------------------

export async function importStatement(
  formData: FormData,
): Promise<ImportSummary> {
  boot();
  const file = formData.get("file") as File | null;
  if (!file) {
    return { batch: "", parsed: 0, inserted: 0, duplicates: 0, errors: ["No file provided."] };
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

// ---- Settings -------------------------------------------------------------

export async function saveSettings(data: Partial<typeof settings.$inferInsert>) {
  boot();
  db.update(settings).set(data).where(eq(settings.id, 1)).run();
  revalidatePath("/settings");
  revalidatePath("/invoices");
}
