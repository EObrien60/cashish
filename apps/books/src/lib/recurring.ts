import { db, first, schema } from "@/db/client";
import { tenantId } from "@/db/context";
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

export async function saveRecurring(input: RecurringInput) {
  const id = input.id ?? uid();
  const tid = tenantId();
  await db.transaction(async (trx) => {
    if (input.id) {
      await trx
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
        .where(and(eq(recurringInvoices.tenantId, tid), eq(recurringInvoices.id, id)));
    } else {
      await trx
        .insert(recurringInvoices)
        .values({
          id,
          tenantId: tid,
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
        });
    }
    await trx
      .delete(recurringInvoiceLines)
      .where(
        and(
          eq(recurringInvoiceLines.tenantId, tid),
          eq(recurringInvoiceLines.recurringId, id),
        ),
      );
    if (input.lines.length) {
      await trx.insert(recurringInvoiceLines).values(
        input.lines.map((l, i) => ({
          id: uid(),
          tenantId: tid,
          recurringId: id,
          productId: l.productId ?? null,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          vatRateId: l.vatRateId ?? null,
          sortOrder: i,
        })),
      );
    }
  });
  return getRecurring(id);
}

export async function getRecurring(id: string) {
  const tid = tenantId();
  const rec = first(
    await db
      .select()
      .from(recurringInvoices)
      .where(and(eq(recurringInvoices.tenantId, tid), eq(recurringInvoices.id, id)))
      .limit(1),
  );
  if (!rec) return null;
  const lines = await db
    .select()
    .from(recurringInvoiceLines)
    .where(
      and(eq(recurringInvoiceLines.tenantId, tid), eq(recurringInvoiceLines.recurringId, id)),
    )
    .orderBy(asc(recurringInvoiceLines.sortOrder));
  return { ...rec, lines };
}

export async function listRecurring() {
  const tid = tenantId();
  const [recs, custRows] = await Promise.all([
    db
      .select()
      .from(recurringInvoices)
      .where(eq(recurringInvoices.tenantId, tid))
      .orderBy(desc(recurringInvoices.createdAt)),
    db.select().from(customers).where(eq(customers.tenantId, tid)),
  ]);
  const custs = new Map(custRows.map((c) => [c.id, c]));
  return recs.map((r) => ({
    ...r,
    customerName: custs.get(r.customerId)?.name ?? "—",
    due: r.status === "active" && r.nextRunDate <= todayISO(),
  }));
}

export async function setRecurringStatus(id: string, status: "active" | "paused") {
  await db
    .update(recurringInvoices)
    .set({ status })
    .where(and(eq(recurringInvoices.tenantId, tenantId()), eq(recurringInvoices.id, id)));
}

export async function deleteRecurring(id: string) {
  const tid = tenantId();
  await db.transaction(async (trx) => {
    await trx
      .delete(recurringInvoiceLines)
      .where(
        and(
          eq(recurringInvoiceLines.tenantId, tid),
          eq(recurringInvoiceLines.recurringId, id),
        ),
      );
    await trx
      .delete(recurringInvoices)
      .where(and(eq(recurringInvoices.tenantId, tid), eq(recurringInvoices.id, id)));
  });
}

// How many invoices are pending generation right now (across all profiles),
// catching up any periods missed while the app was closed.
export async function countDue(refISO = todayISO()): Promise<number> {
  const due = await db
    .select()
    .from(recurringInvoices)
    .where(
      and(
        eq(recurringInvoices.tenantId, tenantId()),
        eq(recurringInvoices.status, "active"),
        lte(recurringInvoices.nextRunDate, refISO),
      ),
    );
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
export async function generateDue(refISO = todayISO()): Promise<GenerateResult> {
  const tid = tenantId();
  const due = await db
    .select()
    .from(recurringInvoices)
    .where(
      and(
        eq(recurringInvoices.tenantId, tid),
        eq(recurringInvoices.status, "active"),
        lte(recurringInvoices.nextRunDate, refISO),
      ),
    );

  let generated = 0;
  let profiles = 0;
  for (const r of due) {
    const tmplLines = await db
      .select()
      .from(recurringInvoiceLines)
      .where(
        and(
          eq(recurringInvoiceLines.tenantId, tid),
          eq(recurringInvoiceLines.recurringId, r.id),
        ),
      )
      .orderBy(asc(recurringInvoiceLines.sortOrder));
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
      await createInvoice({
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
      await db
        .update(recurringInvoices)
        .set({
          nextRunDate: next,
          occurrencesCount: count,
          status: exhausted ? "paused" : "active",
        })
        .where(and(eq(recurringInvoices.tenantId, tid), eq(recurringInvoices.id, r.id)));
    }
  }
  return { generated, profiles };
}
