import { db, schema } from "@/db/client";
import { and, asc, desc, eq, lte } from "drizzle-orm";
import { uid } from "./id";
import { todayISO, addDays } from "./format";
import { createInvoice, type LineInput } from "./invoices";

const { recurringInvoices, recurringInvoiceLines, customers } = schema;

export type RecurringFrequency = "weekly" | "monthly" | "quarterly" | "yearly";

// Advance an ISO date by N periods of the given frequency. Month-based steps
// anchor on the start day and clamp to month length (e.g. Jan 31 -> Feb 28).
export function advanceDate(
  iso: string,
  frequency: RecurringFrequency,
  interval: number,
  anchorDay?: number,
): string {
  const d = new Date(iso + "T00:00:00Z");
  if (frequency === "weekly") {
    d.setUTCDate(d.getUTCDate() + 7 * interval);
    return d.toISOString().slice(0, 10);
  }
  const monthsPer = frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 12;
  const day = anchorDay ?? d.getUTCDate();
  const targetMonth = d.getUTCMonth() + monthsPer * interval;
  const target = new Date(Date.UTC(d.getUTCFullYear(), targetMonth, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export type RecurringInput = {
  id?: string;
  name: string;
  customerId: string;
  frequency: RecurringFrequency;
  interval: number;
  startDate: string;
  endDate?: string | null;
  occurrencesLimit?: number | null;
  dueDays: number;
  autoSend: boolean;
  notes?: string;
  terms?: string;
  lines: LineInput[];
};

export function saveRecurring(input: RecurringInput) {
  const id = input.id ?? uid();
  db.transaction((trx) => {
    if (input.id) {
      trx
        .update(recurringInvoices)
        .set({
          name: input.name,
          customerId: input.customerId,
          frequency: input.frequency,
          interval: input.interval,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          occurrencesLimit: input.occurrencesLimit ?? null,
          dueDays: input.dueDays,
          autoSend: input.autoSend,
          notes: input.notes ?? "",
          terms: input.terms ?? "",
        })
        .where(eq(recurringInvoices.id, id))
        .run();
    } else {
      trx
        .insert(recurringInvoices)
        .values({
          id,
          name: input.name,
          customerId: input.customerId,
          status: "active",
          frequency: input.frequency,
          interval: input.interval,
          startDate: input.startDate,
          nextRunDate: input.startDate,
          endDate: input.endDate ?? null,
          occurrencesLimit: input.occurrencesLimit ?? null,
          occurrencesCount: 0,
          dueDays: input.dueDays,
          autoSend: input.autoSend,
          notes: input.notes ?? "",
          terms: input.terms ?? "",
        })
        .run();
    }
    trx.delete(recurringInvoiceLines).where(eq(recurringInvoiceLines.recurringId, id)).run();
    input.lines.forEach((l, i) => {
      trx
        .insert(recurringInvoiceLines)
        .values({
          id: uid(),
          recurringId: id,
          productId: l.productId ?? null,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          vatRateId: l.vatRateId ?? null,
          sortOrder: i,
        })
        .run();
    });
  });
  return getRecurring(id);
}

export function getRecurring(id: string) {
  const rec = db.select().from(recurringInvoices).where(eq(recurringInvoices.id, id)).get();
  if (!rec) return null;
  const lines = db
    .select()
    .from(recurringInvoiceLines)
    .where(eq(recurringInvoiceLines.recurringId, id))
    .orderBy(asc(recurringInvoiceLines.sortOrder))
    .all();
  return { ...rec, lines };
}

export function listRecurring() {
  const recs = db
    .select()
    .from(recurringInvoices)
    .orderBy(desc(recurringInvoices.createdAt))
    .all();
  const custs = new Map(db.select().from(customers).all().map((c) => [c.id, c]));
  return recs.map((r) => ({
    ...r,
    customerName: custs.get(r.customerId)?.name ?? "—",
    due: r.status === "active" && r.nextRunDate <= todayISO(),
  }));
}

export function setRecurringStatus(id: string, status: "active" | "paused") {
  db.update(recurringInvoices).set({ status }).where(eq(recurringInvoices.id, id)).run();
}

export function deleteRecurring(id: string) {
  db.transaction((trx) => {
    trx.delete(recurringInvoiceLines).where(eq(recurringInvoiceLines.recurringId, id)).run();
    trx.delete(recurringInvoices).where(eq(recurringInvoices.id, id)).run();
  });
}

// How many invoices are pending generation right now (across all profiles),
// catching up any periods missed while the app was closed.
export function countDue(refISO = todayISO()): number {
  const due = db
    .select()
    .from(recurringInvoices)
    .where(and(eq(recurringInvoices.status, "active"), lte(recurringInvoices.nextRunDate, refISO)))
    .all();
  let total = 0;
  for (const r of due) {
    let next = r.nextRunDate;
    let count = r.occurrencesCount;
    while (
      next <= refISO &&
      (!r.endDate || next <= r.endDate) &&
      (r.occurrencesLimit == null || count < r.occurrencesLimit)
    ) {
      total++;
      count++;
      next = advanceDate(next, r.frequency as RecurringFrequency, r.interval, new Date(r.startDate + "T00:00:00Z").getUTCDate());
    }
  }
  return total;
}

export type GenerateResult = { generated: number; profiles: number };

// Generate all due invoices (with catch-up). Each becomes a real invoice via
// the normal createInvoice path, so totals/VAT are computed identically.
export function generateDue(refISO = todayISO()): GenerateResult {
  const due = db
    .select()
    .from(recurringInvoices)
    .where(and(eq(recurringInvoices.status, "active"), lte(recurringInvoices.nextRunDate, refISO)))
    .all();

  let generated = 0;
  let profiles = 0;
  for (const r of due) {
    const tmplLines = db
      .select()
      .from(recurringInvoiceLines)
      .where(eq(recurringInvoiceLines.recurringId, r.id))
      .orderBy(asc(recurringInvoiceLines.sortOrder))
      .all();
    const lineInputs: LineInput[] = tmplLines.map((l) => ({
      productId: l.productId,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      vatRateId: l.vatRateId,
    }));

    let next = r.nextRunDate;
    let count = r.occurrencesCount;
    const anchorDay = new Date(r.startDate + "T00:00:00Z").getUTCDate();
    let any = false;

    while (
      next <= refISO &&
      (!r.endDate || next <= r.endDate) &&
      (r.occurrencesLimit == null || count < r.occurrencesLimit)
    ) {
      createInvoice({
        customerId: r.customerId,
        status: r.autoSend ? "sent" : "draft",
        issueDate: next,
        dueDate: addDays(next, r.dueDays),
        notes: r.notes ?? "",
        terms: r.terms ?? "",
        lines: lineInputs,
      });
      generated++;
      count++;
      any = true;
      next = advanceDate(next, r.frequency as RecurringFrequency, r.interval, anchorDay);
    }

    if (any) {
      profiles++;
      const exhausted =
        (r.endDate && next > r.endDate) ||
        (r.occurrencesLimit != null && count >= r.occurrencesLimit);
      db.update(recurringInvoices)
        .set({
          nextRunDate: next,
          occurrencesCount: count,
          status: exhausted ? "paused" : "active",
        })
        .where(eq(recurringInvoices.id, r.id))
        .run();
    }
  }
  return { generated, profiles };
}
