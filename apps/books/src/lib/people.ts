import { and, asc, desc, eq, gt, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db, first, schema, tenantId } from "@cashish/core/db";
import { uid } from "./id";
import { round2 } from "./format";

const { employees, transactions, payslips, payRuns, rpns } = schema;

// ---------------------------------------------------------------------------
// People, without the payroll ceremony.
//
// The payroll module proper wants an RPN import, a pay run and a payslip before
// it will tell you anything. That is the right shape for filing PAYE, and the
// wrong shape for the much more common question: who did this money go to, and
// how much have they had this year?
//
// So an employee here needs a name and nothing else, and bank transactions can
// be attached to one directly. A pay run can reference the same employee later;
// the two do not interfere.
// ---------------------------------------------------------------------------

/** Splits "Sarah Jane Hughes" into the first/family split the schema expects. */
export function splitName(full: string): { firstName: string; familyName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", familyName: "" };
  if (parts.length === 1) return { firstName: parts[0], familyName: "" };
  return { firstName: parts.slice(0, -1).join(" "), familyName: parts[parts.length - 1] };
}

export const fullName = (e: { firstName: string; familyName: string }) =>
  [e.firstName, e.familyName].filter(Boolean).join(" ").trim();

/**
 * Creates an employee from a name alone.
 *
 * Everything else — PPSN, PRSI class, pay frequency, RPN — is left at its
 * default and can be filled in if and when a payslip is actually produced.
 */
export async function createPerson(input: {
  name: string;
  email?: string;
  startDate?: string | null;
  standardGross?: number;
  notes?: string;
}) {
  const tid = tenantId();
  const { firstName, familyName } = splitName(input.name);
  const existing = (await listPeople()).find(
    (e) => fullName(e).toLowerCase() === input.name.trim().toLowerCase(),
  );
  if (existing) return { employee: existing, created: false };

  const id = uid();
  await db.insert(employees).values({
    id,
    tenantId: tid,
    firstName,
    familyName,
    email: input.email ?? "",
    startDate: input.startDate ?? null,
    standardGross: input.standardGross ?? 0,
  });
  const created = first(
    await db
      .select()
      .from(employees)
      .where(and(eq(employees.tenantId, tid), eq(employees.id, id)))
      .limit(1),
  );
  return { employee: created!, created: true };
}

export async function listPeople(options: { includeLeavers?: boolean } = {}) {
  const conds = [eq(employees.tenantId, tenantId())];
  if (!options.includeLeavers) conds.push(eq(employees.status, "active"));
  return db
    .select()
    .from(employees)
    .where(and(...conds))
    .orderBy(asc(employees.familyName), asc(employees.firstName));
}

/** Attaches (or clears, with null) an employee on the given transactions. */
export async function setTransactionEmployee(
  transactionIds: string[],
  employeeId: string | null,
): Promise<{ updated: number }> {
  if (transactionIds.length === 0) return { updated: 0 };
  const tid = tenantId();

  // An employee id from elsewhere must not be writable onto this tenant's rows.
  // The column's foreign key does not know about tenants, so this is the check
  // that makes it safe.
  if (employeeId) {
    const owns = first(
      await db
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.tenantId, tid), eq(employees.id, employeeId)))
        .limit(1),
    );
    if (!owns) throw new Error(`employee ${employeeId} does not belong to this business`);
  }

  const updated = await db
    .update(transactions)
    .set({ employeeId })
    .where(and(eq(transactions.tenantId, tid), inArray(transactions.id, transactionIds)))
    .returning({ id: transactions.id });
  return { updated: updated.length };
}

/** Total paid to each employee from linked bank transactions, keyed by id. */
export async function paidByEmployee() {
  const tid = tenantId();
  const rows = await db
    .select({
      employeeId: transactions.employeeId,
      paid: sql<string>`sum(abs(${transactions.amount}))`,
      count: sql<string>`count(*)`,
      last: sql<string>`max(${transactions.bookedDate})`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tid),
        isNotNull(transactions.employeeId),
        eq(transactions.excluded, false),
        // Money OUT only. A director funding the company is linked to the same
        // person, and abs() would have added it to what they were paid.
        lt(transactions.amount, 0),
      ),
    )
    .groupBy(transactions.employeeId);
  return new Map(
    rows.map((r) => [
      r.employeeId as string,
      { paid: round2(Number(r.paid)), count: Number(r.count), last: r.last },
    ]),
  );
}

export type PersonDetail = NonNullable<Awaited<ReturnType<typeof getPersonDetail>>>;

export async function getPersonDetail(id: string) {
  const tid = tenantId();
  const employee = first(
    await db
      .select()
      .from(employees)
      .where(and(eq(employees.tenantId, tid), eq(employees.id, id)))
      .limit(1),
  );
  if (!employee) return null;

  const [txs, slips, rpnRows] = await Promise.all([
    db
      .select()
      .from(transactions)
      .where(and(eq(transactions.tenantId, tid), eq(transactions.employeeId, id)))
      .orderBy(desc(transactions.bookedDate)),
    // Payslips are optional here; a person with none is perfectly normal.
    db
      .select({
        id: payslips.id,
        grossPay: payslips.grossPay,
        netPay: payslips.netPay,
        incomeTaxPaid: payslips.incomeTaxPaid,
        employeePrsi: payslips.employeePrsi,
        uscPaid: payslips.uscPaid,
        payDate: payRuns.payDate,
        taxYear: payRuns.taxYear,
        periodNo: payRuns.periodNo,
        runId: payRuns.id,
      })
      .from(payslips)
      .innerJoin(payRuns, and(eq(payslips.payRunId, payRuns.id), eq(payRuns.tenantId, tid)))
      .where(and(eq(payslips.tenantId, tid), eq(payslips.employeeId, id)))
      .orderBy(desc(payRuns.payDate)),
    db
      .select({ id: rpns.id, taxYear: rpns.taxYear, rpnNumber: rpns.rpnNumber })
      .from(rpns)
      .where(and(eq(rpns.tenantId, tid), eq(rpns.employeeId, id))),
  ]);

  const counted = txs.filter((t) => !t.excluded);
  // Split by direction: what they were paid, and anything they put in. A
  // director often appears on both sides, and summing the absolute values would
  // report the two as one number.
  const paidOut = counted.filter((t) => t.amount < 0);
  const cameIn = counted.filter((t) => t.amount > 0);
  /** Paid per calendar year, which is the question actually asked of this data. */
  const byYear = new Map<string, { year: string; paid: number; count: number }>();
  for (const t of paidOut) {
    const year = (t.bookedDate || "").slice(0, 4);
    const y = byYear.get(year) ?? { year, paid: 0, count: 0 };
    y.paid = round2(y.paid + Math.abs(t.amount));
    y.count += 1;
    byYear.set(year, y);
  }

  return {
    employee,
    transactions: txs,
    payslips: slips,
    rpnCount: rpnRows.length,
    totals: {
      paid: round2(paidOut.reduce((s, t) => s + Math.abs(t.amount), 0)),
      count: paidOut.length,
      receivedFrom: round2(cameIn.reduce((s, t) => s + t.amount, 0)),
      receivedCount: cameIn.length,
      excludedCount: txs.length - counted.length,
      firstPaid: paidOut.length ? paidOut[paidOut.length - 1].bookedDate : null,
      lastPaid: paidOut.length ? paidOut[0].bookedDate : null,
      payslipGross: round2(slips.reduce((s, p) => s + p.grossPay, 0)),
      payslipNet: round2(slips.reduce((s, p) => s + p.netPay, 0)),
    },
    byYear: [...byYear.values()].sort((a, b) => b.year.localeCompare(a.year)),
  };
}

export async function setPersonStatus(id: string, status: "active" | "leaver") {
  await db
    .update(employees)
    .set({ status })
    .where(and(eq(employees.tenantId, tenantId()), eq(employees.id, id)));
}
