import { db, first, schema } from "@/db/client";
import { tenantId } from "@/db/context";
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import { uid } from "./id";
import { round2 } from "./format";
import { currentRpn } from "./rpn-import";
import type { Employee, Payslip, Rpn } from "@/db/schema";

const { employees, payRuns, payslips, rpns, settings } = schema;

// ---------------------------------------------------------------------------
// PRSI rate table. "Lighter calc" — these are sensible defaults you must verify
// against the current PRSI Employer Guide each tax year (rates change, and the
// PRSI Credit tapering for low earners is NOT modelled here). Every computed
// PRSI figure is overridable on the payslip.
// ---------------------------------------------------------------------------
const PRSI_RATES: Record<string, { employee: number; employer: number }> = {
  A: { employee: 0.042, employer: 0.089 }, // verify: employer higher rate ~11.15% above weekly threshold
  S: { employee: 0.042, employer: 0 }, // proprietary directors / self-employed
  J: { employee: 0, employer: 0.0089 },
  M: { employee: 0, employer: 0 },
};

function prsiRate(prsiClass: string | null | undefined) {
  const letter = (prsiClass ?? "A").trim().charAt(0).toUpperCase() || "A";
  return PRSI_RATES[letter] ?? PRSI_RATES.A;
}

const PERIODS_PER_YEAR = 12; // monthly

// ---- Employees ------------------------------------------------------------

// tenantId omitted: it is taken from the tenant context on save, never from the
// caller, so a form post cannot move an employee into another tenant.
export type EmployeeInput = Omit<Employee, "createdAt" | "id" | "tenantId"> & {
  id?: string;
};

export async function listEmployees() {
  return db
    .select()
    .from(employees)
    .where(eq(employees.tenantId, tenantId()))
    .orderBy(asc(employees.familyName), asc(employees.firstName));
}

export async function getEmployee(id: string) {
  return first(
    await db
      .select()
      .from(employees)
      .where(and(eq(employees.tenantId, tenantId()), eq(employees.id, id)))
      .limit(1),
  );
}

export async function saveEmployee(input: EmployeeInput) {
  const tid = tenantId();
  if (input.id) {
    const { id, ...rest } = input;
    await db
      .update(employees)
      .set(rest)
      .where(and(eq(employees.tenantId, tid), eq(employees.id, id)));
    return id;
  }
  const id = uid();
  await db.insert(employees).values({ id, ...input, tenantId: tid });
  return id;
}

export async function setEmployeeStatus(
  id: string,
  status: "active" | "leaver",
  dateOfLeaving?: string | null,
) {
  await db
    .update(employees)
    .set({ status, ...(dateOfLeaving !== undefined ? { dateOfLeaving } : {}) })
    .where(and(eq(employees.tenantId, tenantId()), eq(employees.id, id)));
}

// ---- Statutory calc (driven by the RPN, fully overridable) ----------------

type PriorTotals = { payForIncomeTax: number; incomeTaxPaid: number; payForUsc: number; uscPaid: number };

async function priorTotalsThisYear(
  employeeId: string,
  taxYear: number,
  periodNo: number,
): Promise<PriorTotals> {
  const tid = tenantId();
  const rows = await db
    .select({
      payForIncomeTax: payslips.payForIncomeTax,
      incomeTaxPaid: payslips.incomeTaxPaid,
      payForUsc: payslips.payForUsc,
      uscPaid: payslips.uscPaid,
    })
    .from(payslips)
    // Both sides scoped: filtering only payslips would let another tenant's
    // pay run into the year-to-date figures that drive cumulative PAYE.
    .innerJoin(payRuns, and(eq(payslips.payRunId, payRuns.id), eq(payRuns.tenantId, tid)))
    .where(
      and(
        eq(payslips.tenantId, tid),
        eq(payslips.employeeId, employeeId),
        eq(payRuns.taxYear, taxYear),
        lt(payRuns.periodNo, periodNo),
      ),
    );
  return rows.reduce(
    (a, r) => ({
      payForIncomeTax: a.payForIncomeTax + r.payForIncomeTax,
      incomeTaxPaid: a.incomeTaxPaid + r.incomeTaxPaid,
      payForUsc: a.payForUsc + r.payForUsc,
      uscPaid: a.uscPaid + r.uscPaid,
    }),
    { payForIncomeTax: 0, incomeTaxPaid: 0, payForUsc: 0, uscPaid: 0 },
  );
}

function uscOnBands(amount: number, bands: { rate: number; yearlyCutOff: number }[], scale: number): number {
  if (bands.length === 0) return 0;
  // A cutoff of 0 (or missing) marks the top band — no upper limit — so it must
  // sort LAST, not first. Treat it as Infinity for both ordering and the band.
  const eff = (b: { yearlyCutOff: number }) => (b.yearlyCutOff > 0 ? b.yearlyCutOff : Infinity);
  const sorted = [...bands].sort((a, b) => eff(a) - eff(b));
  let usc = 0;
  let prevCut = 0;
  for (const b of sorted) {
    const cut = eff(b) === Infinity ? Infinity : eff(b) * scale;
    const inBand = Math.max(0, Math.min(amount, cut) - prevCut);
    usc += inBand * b.rate;
    prevCut = cut;
    if (amount <= cut) break;
  }
  return usc;
}

export type ComputedDeductions = {
  pensionEmployee: number;
  payForIncomeTax: number;
  incomeTaxPaid: number;
  payForUsc: number;
  uscPaid: number;
  payForEmployeePrsi: number;
  payForEmployerPrsi: number;
  employeePrsi: number;
  employerPrsi: number;
  prsiClass: string;
  prsiExempt: boolean;
  uscStatus: string;
  incomeTaxBasis: string;
  exclusionOrder: boolean;
  taxCreditsThisPeriod: number;
  standardRateCutOff: number;
  lptDeducted: number;
  rpnNumber: string;
};

// Compute suggested deductions for a gross amount, given the employee's current
// RPN. Returns figures that are then stored on the payslip and can be edited.
export async function computeDeductions(
  employee: Employee,
  taxYear: number,
  periodNo: number,
  grossPay: number,
  rpn: Rpn | null,
): Promise<ComputedDeductions> {
  const pensionEmployee = round2(grossPay * (employee.pensionEmployeePct || 0));
  const payForIncomeTax = round2(grossPay - pensionEmployee);
  const payForUsc = round2(grossPay); // USC is on gross (incl. pension)
  const payForEmployeePrsi = round2(grossPay);
  const payForEmployerPrsi = round2(grossPay);

  const basis = rpn?.incomeTaxBasis || "Cumulative";
  const cumulative = basis.toLowerCase().startsWith("cum");
  const exclusionOrder = rpn?.exclusionOrder ?? false;
  const prior = await priorTotalsThisYear(employee.id, taxYear, periodNo);

  // --- PAYE ---
  const yearlyCredit = rpn?.yearlyTaxCredit ?? 0;
  const yearlySrcop = rpn?.yearlyRate1CutOff ?? 0;
  const rate1 = rpn?.taxRate1Pct ?? 0.2;
  const rate2 = rpn?.taxRate2Pct ?? 0.4;
  let incomeTaxPaid = 0;
  let taxCreditsThisPeriod = 0;
  let standardRateCutOff = 0;
  if (exclusionOrder) {
    incomeTaxPaid = 0;
  } else if (cumulative) {
    const periodsElapsed = periodNo;
    const cumGross = round2(rpn?.payForIncomeTaxToDate ?? 0) + prior.payForIncomeTax + payForIncomeTax;
    standardRateCutOff = round2((yearlySrcop * periodsElapsed) / PERIODS_PER_YEAR);
    taxCreditsThisPeriod = round2((yearlyCredit * periodsElapsed) / PERIODS_PER_YEAR);
    const grossTax = Math.min(cumGross, standardRateCutOff) * rate1 + Math.max(0, cumGross - standardRateCutOff) * rate2;
    const taxDue = grossTax - taxCreditsThisPeriod;
    const paidToDate = round2(rpn?.incomeTaxDeductedToDate ?? 0) + prior.incomeTaxPaid;
    incomeTaxPaid = round2(taxDue - paidToDate);
  } else {
    standardRateCutOff = round2(yearlySrcop / PERIODS_PER_YEAR);
    taxCreditsThisPeriod = round2(yearlyCredit / PERIODS_PER_YEAR);
    const grossTax = Math.min(payForIncomeTax, standardRateCutOff) * rate1 + Math.max(0, payForIncomeTax - standardRateCutOff) * rate2;
    incomeTaxPaid = round2(Math.max(0, grossTax - taxCreditsThisPeriod));
  }

  // --- USC ---
  const uscStatus = rpn?.uscStatus || "Ordinary";
  let uscPaid = 0;
  if (uscStatus.toLowerCase() !== "exempt") {
    let bands: { rate: number; yearlyCutOff: number }[] = [];
    try {
      bands = JSON.parse(rpn?.uscBands ?? "[]");
    } catch {
      bands = [];
    }
    if (cumulative) {
      const cumUscPay = round2(rpn?.payForUscToDate ?? 0) + prior.payForUsc + payForUsc;
      const uscDue = uscOnBands(cumUscPay, bands, periodNo / PERIODS_PER_YEAR);
      const uscPaidToDate = round2(rpn?.uscDeductedToDate ?? 0) + prior.uscPaid;
      uscPaid = round2(uscDue - uscPaidToDate);
    } else {
      uscPaid = round2(uscOnBands(payForUsc, bands, 1 / PERIODS_PER_YEAR));
    }
  }

  // --- PRSI ---
  const prsiClass = rpn?.prsiClass?.trim() || employee.prsiClass || "A";
  const prsiExempt = rpn?.prsiExempt ?? false;
  const r = prsiRate(prsiClass);
  const employeePrsi = prsiExempt ? 0 : round2(payForEmployeePrsi * r.employee);
  const employerPrsi = prsiExempt ? 0 : round2(payForEmployerPrsi * r.employer);

  // --- LPT (spread the annual amount over the year) ---
  const lptDeducted = round2((rpn?.lptToDeduct ?? 0) / PERIODS_PER_YEAR);

  return {
    pensionEmployee,
    payForIncomeTax,
    incomeTaxPaid,
    payForUsc,
    uscPaid,
    payForEmployeePrsi,
    payForEmployerPrsi,
    employeePrsi,
    employerPrsi,
    prsiClass,
    prsiExempt,
    uscStatus,
    incomeTaxBasis: basis,
    exclusionOrder,
    taxCreditsThisPeriod,
    standardRateCutOff,
    lptDeducted,
    rpnNumber: rpn?.rpnNumber ?? "",
  };
}

export function netOf(s: Pick<Payslip, "grossPay" | "pensionEmployee" | "incomeTaxPaid" | "employeePrsi" | "uscPaid" | "lptDeducted" | "otherDeductions">): number {
  return round2(
    s.grossPay - s.pensionEmployee - s.incomeTaxPaid - s.employeePrsi - s.uscPaid - s.lptDeducted - s.otherDeductions,
  );
}

// ---- Pay runs -------------------------------------------------------------

export async function listPayRuns() {
  const tid = tenantId();
  const runs = await db
    .select()
    .from(payRuns)
    .where(eq(payRuns.tenantId, tid))
    .orderBy(desc(payRuns.taxYear), desc(payRuns.periodNo));
  if (runs.length === 0) return [];
  // One query for every run's slips rather than one per run: this was a
  // free extra read per row on a local file and a round-trip each against Neon.
  const slipRows = await db
    .select()
    .from(payslips)
    .where(
      and(
        eq(payslips.tenantId, tid),
        inArray(
          payslips.payRunId,
          runs.map((r) => r.id),
        ),
      ),
    );
  const byRun = new Map<string, typeof slipRows>();
  for (const slip of slipRows) {
    const list = byRun.get(slip.payRunId) ?? [];
    list.push(slip);
    byRun.set(slip.payRunId, list);
  }
  return runs.map((r) => {
    const slips = byRun.get(r.id) ?? [];
    const gross = round2(slips.reduce((s, p) => s + p.grossPay, 0));
    const net = round2(slips.reduce((s, p) => s + p.netPay, 0));
    return { ...r, employees: slips.length, gross, net };
  });
}

export async function createPayRun(taxYear: number, periodNo: number, payDate: string) {
  const id = uid();
  const tid = tenantId();
  const ref = `cashish-${taxYear}-M${String(periodNo).padStart(2, "0")}`;
  await db.insert(payRuns).values({
    id,
    tenantId: tid,
    taxYear,
    periodNo,
    payDate,
    frequency: "Monthly",
    payrollRunReference: ref,
    status: "draft",
  });

  // Seed a payslip per active employee from their default gross + current RPN.
  const emps = await db
    .select()
    .from(employees)
    .where(and(eq(employees.tenantId, tid), eq(employees.status, "active")));
  for (const e of emps) {
    const rpn = await currentRpn(e.id, taxYear);
    const gross = round2(e.standardGross);
    const d = await computeDeductions(e, taxYear, periodNo, gross, rpn);
    const slip = {
      id: uid(),
      tenantId: tid,
      payRunId: id,
      employeeId: e.id,
      rpnNumber: d.rpnNumber,
      incomeTaxBasis: d.incomeTaxBasis,
      exclusionOrder: d.exclusionOrder,
      taxCreditsThisPeriod: d.taxCreditsThisPeriod,
      standardRateCutOff: d.standardRateCutOff,
      grossPay: gross,
      pensionEmployee: d.pensionEmployee,
      pensionEmployer: 0,
      payForIncomeTax: d.payForIncomeTax,
      incomeTaxPaid: d.incomeTaxPaid,
      payForEmployeePrsi: d.payForEmployeePrsi,
      payForEmployerPrsi: d.payForEmployerPrsi,
      employeePrsi: d.employeePrsi,
      employerPrsi: d.employerPrsi,
      prsiClass: d.prsiClass,
      insurableWeeks: 4,
      prsiExempt: d.prsiExempt,
      payForUsc: d.payForUsc,
      uscStatus: d.uscStatus,
      uscPaid: d.uscPaid,
      lptDeducted: d.lptDeducted,
      otherDeductions: 0,
      otherDeductionsLabel: "",
      netPay: 0,
      notes: "",
    };
    slip.netPay = netOf(slip);
    await db.insert(payslips).values(slip);
  }
  return id;
}

export async function getPayRun(id: string) {
  const tid = tenantId();
  const run = first(
    await db
      .select()
      .from(payRuns)
      .where(and(eq(payRuns.tenantId, tid), eq(payRuns.id, id)))
      .limit(1),
  );
  if (!run) return null;
  const [slips, empRows] = await Promise.all([
    db
      .select()
      .from(payslips)
      .where(and(eq(payslips.tenantId, tid), eq(payslips.payRunId, id))),
    db.select().from(employees).where(eq(employees.tenantId, tid)),
  ]);
  const empMap = new Map(empRows.map((e) => [e.id, e]));
  const withEmp = slips
    .map((s) => ({ ...s, employee: empMap.get(s.employeeId)! }))
    .filter((s) => s.employee)
    .sort((a, b) => a.employee.familyName.localeCompare(b.employee.familyName));
  return { ...run, slips: withEmp };
}

export async function getPayslip(id: string) {
  const tid = tenantId();
  const slip = first(
    await db
      .select()
      .from(payslips)
      .where(and(eq(payslips.tenantId, tid), eq(payslips.id, id)))
      .limit(1),
  );
  if (!slip) return null;
  const [employee, run] = await Promise.all([
    getEmployee(slip.employeeId),
    db
      .select()
      .from(payRuns)
      .where(and(eq(payRuns.tenantId, tid), eq(payRuns.id, slip.payRunId)))
      .limit(1)
      .then(first),
  ]);
  return { ...slip, employee, run };
}

// Apply edits to a payslip and recompute net.
export async function updatePayslip(id: string, patch: Partial<Payslip>) {
  const tid = tenantId();
  const current = first(
    await db
      .select()
      .from(payslips)
      .where(and(eq(payslips.tenantId, tid), eq(payslips.id, id)))
      .limit(1),
  );
  if (!current) return;
  const merged = { ...current, ...patch };
  merged.netPay = netOf(merged);
  // tenantId is stripped alongside id: neither is ever a patchable field, and
  // letting one through would move a payslip between tenants.
  const { id: _omitId, tenantId: _omitTenant, ...rest } = merged;
  await db
    .update(payslips)
    .set(rest)
    .where(and(eq(payslips.tenantId, tid), eq(payslips.id, id)));
}

// Re-run the RPN-driven calc for a slip's current gross (the "recompute" button).
export async function recomputePayslip(id: string) {
  const tid = tenantId();
  const slip = first(
    await db
      .select()
      .from(payslips)
      .where(and(eq(payslips.tenantId, tid), eq(payslips.id, id)))
      .limit(1),
  );
  if (!slip) return;
  const [run, emp] = await Promise.all([
    db
      .select()
      .from(payRuns)
      .where(and(eq(payRuns.tenantId, tid), eq(payRuns.id, slip.payRunId)))
      .limit(1)
      .then(first),
    getEmployee(slip.employeeId),
  ]);
  if (!run || !emp) return;
  const rpn = await currentRpn(emp.id, run.taxYear);
  const d = await computeDeductions(emp, run.taxYear, run.periodNo, slip.grossPay, rpn);
  await updatePayslip(id, {
    rpnNumber: d.rpnNumber,
    incomeTaxBasis: d.incomeTaxBasis,
    exclusionOrder: d.exclusionOrder,
    taxCreditsThisPeriod: d.taxCreditsThisPeriod,
    standardRateCutOff: d.standardRateCutOff,
    pensionEmployee: d.pensionEmployee,
    payForIncomeTax: d.payForIncomeTax,
    incomeTaxPaid: d.incomeTaxPaid,
    payForEmployeePrsi: d.payForEmployeePrsi,
    payForEmployerPrsi: d.payForEmployerPrsi,
    employeePrsi: d.employeePrsi,
    employerPrsi: d.employerPrsi,
    prsiClass: d.prsiClass,
    prsiExempt: d.prsiExempt,
    payForUsc: d.payForUsc,
    uscStatus: d.uscStatus,
    uscPaid: d.uscPaid,
    lptDeducted: d.lptDeducted,
  });
}

export async function setPayRunStatus(id: string, status: "draft" | "finalised") {
  await db
    .update(payRuns)
    .set({ status })
    .where(and(eq(payRuns.tenantId, tenantId()), eq(payRuns.id, id)));
}

export async function deletePayRun(id: string) {
  const tid = tenantId();
  await db.transaction(async (trx) => {
    await trx
      .delete(payslips)
      .where(and(eq(payslips.tenantId, tid), eq(payslips.payRunId, id)));
    await trx.delete(payRuns).where(and(eq(payRuns.tenantId, tid), eq(payRuns.id, id)));
  });
}

// ---- PSR (Payroll Submission Request) export ------------------------------
// Builds a PAYE Modernisation payroll submission following Revenue's PSR
// data-items spec. Validate against ROS before filing live — this is a working
// figure, not a guarantee of a successful submission.

export async function buildPsr(payRunId: string, softwareVersion: string) {
  const run = await getPayRun(payRunId);
  if (!run) return null;
  const s = first(
    await db
      .select()
      .from(settings)
      .where(eq(settings.tenantId, tenantId()))
      .limit(1),
  );

  const lineItems = run.slips.map((slip, i) => {
    const e = slip.employee;
    const item: Record<string, unknown> = {
      lineItemID: i + 1,
      employeeID: {
        ...(e.employerReference ? { employerReference: e.employerReference } : {}),
        employmentID: e.employmentId,
        ...(e.ppsn ? { employeePPSN: e.ppsn } : {}),
      },
      employeeName: { firstName: e.firstName, familyName: e.familyName },
      ...(e.startDate ? { employmentStartDate: e.startDate } : {}),
      ...(e.dateOfLeaving ? { dateOfLeaving: e.dateOfLeaving } : {}),
      payDate: run.payDate,
      payFrequency: "Monthly",
      payPeriod: run.periodNo,
      expectedNumberOfPayPeriodsInYear: PERIODS_PER_YEAR,
      ...(slip.rpnNumber ? { rpnNumber: slip.rpnNumber } : {}),
      incomeTaxCalculationBasis: slip.incomeTaxBasis,
      exclusionOrder: slip.exclusionOrder,
      taxCreditsThisPeriod: round2(slip.taxCreditsThisPeriod ?? 0),
      standardRateCutOff: round2(slip.standardRateCutOff ?? 0),
      grossPay: round2(slip.grossPay),
      payForIncomeTax: round2(slip.payForIncomeTax),
      incomeTaxPaid: round2(slip.incomeTaxPaid),
      payForEmployeePRSI: round2(slip.payForEmployeePrsi),
      payForEmployerPRSI: round2(slip.payForEmployerPrsi),
      prsiExempt: slip.prsiExempt,
      payForUSC: round2(slip.payForUsc),
      uscStatus: slip.uscStatus,
      uscPaid: round2(slip.uscPaid),
      ...(slip.lptDeducted ? { lptDeducted: round2(slip.lptDeducted) } : {}),
      ...(e.director ? { director: e.director === "proprietary" ? "Proprietary Director" : "Non Proprietary Director" } : {}),
    };
    if (!slip.prsiExempt) {
      item.prsiClassDetails = [
        {
          prsiClass: slip.prsiClass,
          insurableWeeks: slip.insurableWeeks,
          employeePRSIPaid: round2(slip.employeePrsi),
          employerPRSIPaid: round2(slip.employerPrsi),
        },
      ];
    }
    return item;
  });

  return {
    payrollSubmission: {
      employerRegistrationNumber: s?.employerRegNumber ?? "",
      payrollRunReference: run.payrollRunReference,
      taxYear: run.taxYear,
      softwareUsed: "cashish",
      softwareVersion,
      submissionItems: lineItems,
    },
  };
}
