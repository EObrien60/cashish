import { createHash } from "node:crypto";
import Papa from "papaparse";
import { and, asc, desc, eq, gte, ilike, inArray, lte, lt, or } from "drizzle-orm";
import { db, first, schema, tenantId } from "@cashish/core/db";
import type { Timesheet, Transaction } from "@cashish/core/db";
import { uid } from "./id";
import { addDays, round2 } from "./format";
import { toISODate } from "./import";
import { notExcluded } from "./transactions";

const { contractors, timesheets, timesheetPayments, transactions } = schema;

// ---------------------------------------------------------------------------
// Contractors, their timesheets, and the bank lines that paid them.
//
// A platform like Upwork does not pay each contractor from your account. It
// charges you one lump a week — everybody's hours plus its fee — so a single
// bank line settles MANY timesheets. timesheet_payments records how much of
// that line went to each one; whatever is left over is the platform's cut.
// ---------------------------------------------------------------------------

export type ContractorInput = {
  name: string;
  email?: string;
  platform?: "upwork" | "direct";
  platformRef?: string;
  defaultRate?: number;
  currency?: string;
  status?: "active" | "inactive";
};

const ofTenant = () => eq(contractors.tenantId, tenantId());

export async function listContractors() {
  return db.select().from(contractors).where(ofTenant()).orderBy(asc(contractors.name));
}

async function getContractor(id: string) {
  return first(
    await db.select().from(contractors).where(and(ofTenant(), eq(contractors.id, id))).limit(1),
  );
}

async function findContractor(nameOrRef: string) {
  const needle = nameOrRef.trim().toLowerCase();
  const all = await listContractors();
  return (
    all.find((c) => (c.platformRef ?? "").trim().toLowerCase() === needle) ??
    all.find((c) => c.name.trim().toLowerCase() === needle) ??
    null
  );
}

export async function createContractor(input: ContractorInput) {
  const existing = await findContractor(input.name);
  if (existing) return { contractor: existing, created: false };
  const id = uid();
  await db.insert(contractors).values({
    id,
    tenantId: tenantId(),
    name: input.name.trim(),
    email: input.email ?? "",
    platform: input.platform ?? "direct",
    platformRef: input.platformRef ?? "",
    defaultRate: input.defaultRate ?? 0,
    currency: input.currency ?? "EUR",
    status: input.status ?? "active",
  });
  return { contractor: (await getContractor(id))!, created: true };
}

export async function updateContractor(id: string, input: Partial<ContractorInput>) {
  const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  if (Object.keys(patch).length) {
    await db.update(contractors).set(patch).where(and(ofTenant(), eq(contractors.id, id)));
  }
  return getContractor(id);
}

// --- Timesheets --------------------------------------------------------------

export type TimesheetInput = {
  contractorId: string;
  periodStart?: string | null;
  periodEnd: string;
  hours?: number;
  /** Defaults to the contractor's rate. */
  rate?: number;
  /** Defaults to hours × rate. Set it for a fixed-price piece of work. */
  amount?: number;
  currency?: string;
  memo?: string;
};

export async function createTimesheet(input: TimesheetInput) {
  const contractor = await getContractor(input.contractorId);
  if (!contractor) throw new Error("contractor not found");
  const hours = input.hours ?? 0;
  const rate = input.rate ?? contractor.defaultRate;
  const id = uid();
  await db.insert(timesheets).values({
    id,
    tenantId: tenantId(),
    contractorId: contractor.id,
    periodStart: input.periodStart || null,
    periodEnd: input.periodEnd,
    hours,
    rate,
    amount: input.amount ?? round2(hours * rate),
    currency: input.currency ?? contractor.currency,
    source: "manual",
    memo: input.memo ?? "",
  });
  return (await db.select().from(timesheets).where(eq(timesheets.id, id)))[0];
}

export async function deleteTimesheet(id: string) {
  await db.delete(timesheets).where(and(eq(timesheets.tenantId, tenantId()), eq(timesheets.id, id)));
}

export type TimesheetRow = Timesheet & {
  contractorName: string;
  paid: number;
  status: "unpaid" | "paid";
  paidBy: { transactionId: string; amount: number; bookedDate: string; description: string }[];
};

export async function listTimesheets(options: { status?: "unpaid" | "paid" } = {}): Promise<TimesheetRow[]> {
  const tid = tenantId();
  const [sheets, people, allocs] = await Promise.all([
    db
      .select()
      .from(timesheets)
      .where(eq(timesheets.tenantId, tid))
      .orderBy(desc(timesheets.periodEnd), asc(timesheets.createdAt)),
    listContractors(),
    db
      .select({
        timesheetId: timesheetPayments.timesheetId,
        transactionId: timesheetPayments.transactionId,
        amount: timesheetPayments.amount,
        bookedDate: transactions.bookedDate,
        description: transactions.description,
      })
      .from(timesheetPayments)
      .innerJoin(
        transactions,
        and(eq(transactions.tenantId, timesheetPayments.tenantId), eq(transactions.id, timesheetPayments.transactionId)),
      )
      .where(eq(timesheetPayments.tenantId, tid)),
  ]);
  const names = new Map(people.map((c) => [c.id, c.name]));
  const rows = sheets.map((s) => {
    const paidBy = allocs
      .filter((a) => a.timesheetId === s.id)
      .map((a) => ({ ...a, description: a.description ?? "" }));
    const paid = round2(paidBy.reduce((sum, a) => sum + a.amount, 0));
    return {
      ...s,
      contractorName: names.get(s.contractorId) ?? "",
      paid,
      // A cent of rounding in the platform's favour must not leave it "unpaid".
      status: (paid >= s.amount - 0.005 ? "paid" : "unpaid") as "paid" | "unpaid",
      paidBy,
    };
  });
  return options.status ? rows.filter((r) => r.status === options.status) : rows;
}

export async function contractorTotals() {
  const out = new Map<string, { hours: number; billed: number; paid: number; unpaid: number; count: number }>();
  for (const s of await listTimesheets()) {
    const t = out.get(s.contractorId) ?? { hours: 0, billed: 0, paid: 0, unpaid: 0, count: 0 };
    const paid = Math.min(s.paid, s.amount);
    t.hours = round2(t.hours + s.hours);
    t.billed = round2(t.billed + s.amount);
    t.paid = round2(t.paid + paid);
    t.unpaid = round2(t.billed - t.paid);
    t.count += 1;
    out.set(s.contractorId, t);
  }
  return out;
}

// --- Paying timesheets from a bank line -------------------------------------

// What the bank line is worth in the timesheets' currency, or null when it
// cannot be said. A USD Upwork invoice paid from a EUR account is comparable
// through the card's original amount; without one, no fee can be worked out.
function comparableAmount(tx: Transaction, currency: string): number | null {
  if (tx.origCurrency === currency && tx.origAmount != null) return Math.abs(tx.origAmount);
  if ((tx.currency || "EUR") === currency) return Math.abs(tx.amount);
  return null;
}

async function allocatedTo(transactionId: string) {
  const rows = await db
    .select({ amount: timesheetPayments.amount })
    .from(timesheetPayments)
    .where(and(eq(timesheetPayments.tenantId, tenantId()), eq(timesheetPayments.transactionId, transactionId)));
  return round2(rows.reduce((s, r) => s + r.amount, 0));
}

async function sheetsById(ids: string[]) {
  const wanted = new Set(ids);
  const rows = (await listTimesheets()).filter((s) => wanted.has(s.id));
  if (rows.length !== wanted.size) throw new Error("timesheet not found");
  return rows;
}

/**
 * Pays timesheets from one bank line. Each gets what it still owes, capped by
 * what is left of the line, so a line can never be spent twice. Returns the
 * fee — the part of the line no timesheet accounts for — but does not post it;
 * that is the caller's (or a later version's) decision.
 */
export async function linkPayment(transactionId: string, timesheetIds: string[]) {
  const tid = tenantId();
  const sheets = await sheetsById(timesheetIds);
  const tx = first(
    await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.tenantId, tid), eq(transactions.id, transactionId)))
      .limit(1),
  );
  if (!tx) throw new Error("transaction not found");
  if (tx.amount >= 0) throw new Error("only a payment out can pay a timesheet");

  const worth = comparableAmount(tx, sheets[0]?.currency ?? "EUR");
  let left = worth === null ? Infinity : round2(worth - (await allocatedTo(transactionId)));
  let allocated = 0;
  await db.transaction(async (trx) => {
    for (const s of sheets) {
      const give = round2(Math.min(s.amount - s.paid, left));
      if (give <= 0) continue;
      await trx.insert(timesheetPayments).values({
        id: uid(),
        tenantId: tid,
        timesheetId: s.id,
        transactionId,
        amount: give,
      });
      left = round2(left - give);
      allocated = round2(allocated + give);
    }
  });
  return {
    allocated,
    fee: worth === null ? null : round2(worth - (await allocatedTo(transactionId))),
  };
}

export async function unlinkPayment(timesheetId: string, transactionId: string) {
  await db
    .delete(timesheetPayments)
    .where(
      and(
        eq(timesheetPayments.tenantId, tenantId()),
        eq(timesheetPayments.timesheetId, timesheetId),
        eq(timesheetPayments.transactionId, transactionId),
      ),
    );
}

/**
 * Bank lines that look like the platform charge for these timesheets: money
 * out, "Upwork" in the text, within a week of the latest period end, and big
 * enough to cover what is still owed. Closest date first.
 */
export async function suggestPayments(timesheetIds: string[]) {
  const sheets = await sheetsById(timesheetIds);
  if (sheets.length === 0) return [];
  const owed = round2(sheets.reduce((s, x) => s + Math.max(0, x.amount - x.paid), 0));
  const end = sheets.map((s) => s.periodEnd).sort().at(-1)!;
  const currency = sheets[0].currency;
  const like = "%upwork%";
  const candidates = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tenantId()),
        lt(transactions.amount, 0),
        gte(transactions.bookedDate, addDays(end, -7)),
        lte(transactions.bookedDate, addDays(end, 7)),
        or(ilike(transactions.description, like), ilike(transactions.reference, like), ilike(transactions.payer, like)),
        notExcluded(),
      ),
    );
  const out = [];
  for (const tx of candidates) {
    const worth = comparableAmount(tx, currency);
    const free = worth === null ? null : round2(worth - (await allocatedTo(tx.id)));
    if (free !== null && free < owed) continue;
    out.push({
      id: tx.id,
      bookedDate: tx.bookedDate,
      description: tx.description ?? "",
      amount: tx.amount,
      currency: tx.currency ?? "EUR",
      fee: free === null ? null : round2(free - owed),
    });
  }
  const gap = (d: string) => Math.abs(Date.parse(d) - Date.parse(end));
  return out.sort((a, b) => gap(a.bookedDate) - gap(b.bookedDate));
}

// --- Importing -----------------------------------------------------------------
// Every source — the Upwork CSV today, the Upwork API later — normalises into
// TimesheetImportRow and goes through importTimesheetRows(), so idempotency and
// contractor matching live in one place.

export type TimesheetImportRow = {
  externalRef: string;
  contractor: string;
  periodStart: string | null;
  periodEnd: string;
  hours: number;
  rate: number;
  amount: number;
  currency: string;
  memo: string;
};

export type ImportSummary = {
  parsed: number;
  imported: number;
  duplicates: number;
  skipped: number;
  contractorsCreated: number;
  errors: string[];
};

export async function importTimesheetRows(
  rows: TimesheetImportRow[],
  source: "upwork_csv" | "upwork_api",
): Promise<Pick<ImportSummary, "imported" | "duplicates" | "contractorsCreated">> {
  const tid = tenantId();
  const refs = rows.map((r) => r.externalRef);
  const seen = new Set(
    refs.length
      ? (
          await db
            .select({ ref: timesheets.externalRef })
            .from(timesheets)
            .where(and(eq(timesheets.tenantId, tid), inArray(timesheets.externalRef, refs)))
        ).map((r) => r.ref)
      : [],
  );
  let imported = 0;
  let duplicates = 0;
  let contractorsCreated = 0;
  for (const r of rows) {
    if (seen.has(r.externalRef)) {
      duplicates++;
      continue;
    }
    seen.add(r.externalRef);
    const { contractor, created } = await createContractor({
      name: r.contractor,
      platform: "upwork",
      platformRef: r.contractor,
      defaultRate: r.rate,
      currency: r.currency,
    });
    if (created) contractorsCreated++;
    await db
      .insert(timesheets)
      .values({
        id: uid(),
        tenantId: tid,
        contractorId: contractor.id,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        hours: r.hours,
        rate: r.rate,
        amount: r.amount,
        currency: r.currency,
        source,
        externalRef: r.externalRef,
        memo: r.memo,
      })
      .onConflictDoNothing();
    imported++;
  }
  return { imported, duplicates, contractorsCreated };
}

// Header spellings seen across Upwork's client exports; normalised the same way
// lib/import.ts does (lowercase, non-alphanumerics stripped).
const ALIASES: Record<string, string[]> = {
  date: ["date", "transactiondate"],
  ref: ["refid", "transactionid", "id", "reference"],
  type: ["type", "transactiontype"],
  description: ["description", "transactionsummary", "memo"],
  contractor: ["freelancer", "contractor", "freelancername", "talent"],
  amount: ["amount", "amountusd", "amounteur"],
  currency: ["currency"],
  hours: ["hours", "hoursworked"],
  rate: ["rate", "hourlyrate"],
};

// Only lines that are work. Service fees, VAT, funding payments and refunds are
// the platform's own traffic and show up in the fee instead.
const BILLING = /hourly|fixed|milestone|bonus|manual time/i;

const MON: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

// Upwork writes "Sep 8, 2026" in the date column and US "09/01/2026" in
// descriptions. new Date() would read the first as LOCAL midnight, which in
// Irish summer time is the previous day in UTC — so parse both by hand.
function upworkDate(raw: string): string {
  const v = raw.trim();
  let m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(v);
  if (m && MON[m[1].toLowerCase()]) return `${m[3]}-${MON[m[1].toLowerCase()]}-${m[2].padStart(2, "0")}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return toISODate(v);
}

const num = (v: string | undefined) => {
  const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export function parseUpworkCsv(text: string) {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const headers = new Map((parsed.meta.fields ?? []).map((h) => [h.toLowerCase().replace(/[^a-z0-9]/g, ""), h]));
  const col = (field: string) => ALIASES[field].map((a) => headers.get(a)).find(Boolean);
  const cols = Object.fromEntries(Object.keys(ALIASES).map((f) => [f, col(f)])) as Record<string, string | undefined>;
  const get = (row: Record<string, string>, f: string) => (cols[f] ? (row[cols[f]!] ?? "").trim() : "");

  const errors: string[] = [];
  if (!cols.date || !cols.amount) {
    errors.push("Could not find 'Date' and 'Amount' columns — is this an Upwork transaction history CSV?");
    return { rows: [] as TimesheetImportRow[], parsed: 0, skipped: 0, errors };
  }

  const rows: TimesheetImportRow[] = [];
  let skipped = 0;
  parsed.data.forEach((row, i) => {
    const type = get(row, "type");
    const description = get(row, "description");
    const contractor = get(row, "contractor");
    if (!BILLING.test(type || description) || !contractor) {
      skipped++;
      return;
    }
    const date = upworkDate(get(row, "date"));
    const amount = round2(Math.abs(num(get(row, "amount"))));
    if (!date || !amount) {
      errors.push(`Row ${i + 2}: no readable date or amount — skipped.`);
      skipped++;
      return;
    }
    const period = /(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/.exec(description);
    const hhmm = /(\d+):(\d{2})\s*hrs?\b/i.exec(description);
    const dec = /(\d+(?:\.\d+)?)\s*(?:hrs?|hours)\b/i.exec(description);
    const hours = num(get(row, "hours")) || (hhmm ? Number(hhmm[1]) + Number(hhmm[2]) / 60 : dec ? Number(dec[1]) : 0);
    const rateInDesc = /@\s*\D{0,3}(\d+(?:\.\d+)?)\s*\/\s*h/i.exec(description);
    const rate = num(get(row, "rate")) || (rateInDesc ? Number(rateInDesc[1]) : hours ? round2(amount / hours) : 0);
    const ref =
      get(row, "ref") ||
      `csv_${createHash("sha256").update([date, contractor, amount, description].join("|")).digest("hex").slice(0, 32)}`;
    rows.push({
      externalRef: ref,
      contractor,
      periodStart: period ? upworkDate(period[1]) : null,
      periodEnd: period ? upworkDate(period[2]) : date,
      hours: round2(hours),
      rate,
      amount,
      currency: get(row, "currency") || "EUR",
      memo: description,
    });
  });
  return { rows, parsed: parsed.data.length, skipped, errors };
}

export async function importUpworkCsv(text: string): Promise<ImportSummary> {
  const { rows, parsed, skipped, errors } = parseUpworkCsv(text);
  const r = await importTimesheetRows(rows, "upwork_csv");
  return { parsed, skipped, errors, ...r };
}
