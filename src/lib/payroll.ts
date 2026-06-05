import { db, schema } from "@/db/client";
import { and, asc, desc, eq, lt } from "drizzle-orm";
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

export type EmployeeInput = Omit<Employee, "createdAt" | "id"> & { id?: string };

export function listEmployees() {
  return db.select().from(employees).orderBy(asc(employees.familyName), asc(employees.firstName)).all();
}

export function getEmployee(id: string) {
  return db.select().from(employees).where(eq(employees.id, id)).get() ?? null;
}

export function saveEmployee(input: EmployeeInput) {
  if (input.id) {
    const { id, ...rest } = input;
    db.update(employees).set(rest).where(eq(employees.id, id)).run();
    return id;
  }
  const id = uid();
  db.insert(employees).values({ id, ...input }).run();
  return id;
}

export function setEmployeeStatus(id: string, status: "active" | "leaver", dateOfLeaving?: string | null) {
  db.update(employees)
    .set({ status, ...(dateOfLeaving !== undefined ? { dateOfLeaving } : {}) })
    .where(eq(employees.id, id))
    .run();
}

// ---- Statutory calc (driven by the RPN, fully overridable) ----------------

type PriorTotals = { payForIncomeTax: number; incomeTaxPaid: number; payForUsc: number; uscPaid: number };

function priorTotalsThisYear(employeeId: string, taxYear: number, periodNo: number): PriorTotals {
  const rows = db
    .select({
      payForIncomeTax: payslips.payForIncomeTax,
      incomeTaxPaid: payslips.incomeTaxPaid,
      payForUsc: payslips.payForUsc,
      uscPaid: payslips.uscPaid,
    })
    .from(payslips)
    .innerJoin(payRuns, eq(payslips.payRunId, payRuns.id))
    .where(and(eq(payslips.employeeId, employeeId), eq(payRuns.taxYear, taxYear), lt(payRuns.periodNo, periodNo)))
    .all();
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
export function computeDeductions(
  employee: Employee,
  taxYear: number,
  periodNo: number,
  grossPay: number,
  rpn: Rpn | null,
): ComputedDeductions {
  const pensionEmployee = round2(grossPay * (employee.pensionEmployeePct || 0));
  const payForIncomeTax = round2(grossPay - pensionEmployee);
  const payForUsc = round2(grossPay); // USC is on gross (incl. pension)
  const payForEmployeePrsi = round2(grossPay);
  const payForEmployerPrsi = round2(grossPay);

  const basis = rpn?.incomeTaxBasis || "Cumulative";
  const cumulative = basis.toLowerCase().startsWith("cum");
  const exclusionOrder = rpn?.exclusionOrder ?? false;
  const prior = priorTotalsThisYear(employee.id, taxYear, periodNo);

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

export function listPayRuns() {
  const runs = db.select().from(payRuns).orderBy(desc(payRuns.taxYear), desc(payRuns.periodNo)).all();
  return runs.map((r) => {
    const slips = db.select().from(payslips).where(eq(payslips.payRunId, r.id)).all();
    const gross = round2(slips.reduce((s, p) => s + p.grossPay, 0));
    const net = round2(slips.reduce((s, p) => s + p.netPay, 0));
    return { ...r, employees: slips.length, gross, net };
  });
}

export function createPayRun(taxYear: number, periodNo: number, payDate: string) {
  const id = uid();
  const ref = `cashish-${taxYear}-M${String(periodNo).padStart(2, "0")}`;
  db.insert(payRuns).values({ id, taxYear, periodNo, payDate, frequency: "Monthly", payrollRunReference: ref, status: "draft" }).run();

  // Seed a payslip per active employee from their default gross + current RPN.
  const emps = db.select().from(employees).where(eq(employees.status, "active")).all();
  for (const e of emps) {
    const rpn = currentRpn(e.id, taxYear);
    const gross = round2(e.standardGross);
    const d = computeDeductions(e, taxYear, periodNo, gross, rpn);
    const slip = {
      id: uid(),
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
    db.insert(payslips).values(slip).run();
  }
  return id;
}

export function getPayRun(id: string) {
  const run = db.select().from(payRuns).where(eq(payRuns.id, id)).get();
  if (!run) return null;
  const slips = db.select().from(payslips).where(eq(payslips.payRunId, id)).all();
  const empMap = new Map(db.select().from(employees).all().map((e) => [e.id, e]));
  const withEmp = slips
    .map((s) => ({ ...s, employee: empMap.get(s.employeeId)! }))
    .filter((s) => s.employee)
    .sort((a, b) => a.employee.familyName.localeCompare(b.employee.familyName));
  return { ...run, slips: withEmp };
}

export function getPayslip(id: string) {
  const slip = db.select().from(payslips).where(eq(payslips.id, id)).get();
  if (!slip) return null;
  const employee = getEmployee(slip.employeeId);
  const run = db.select().from(payRuns).where(eq(payRuns.id, slip.payRunId)).get();
  return { ...slip, employee, run };
}

// Apply edits to a payslip and recompute net.
export function updatePayslip(id: string, patch: Partial<Payslip>) {
  const current = db.select().from(payslips).where(eq(payslips.id, id)).get();
  if (!current) return;
  const merged = { ...current, ...patch };
  merged.netPay = netOf(merged);
  const { id: _omit, ...rest } = merged;
  db.update(payslips).set(rest).where(eq(payslips.id, id)).run();
}

// Re-run the RPN-driven calc for a slip's current gross (the "recompute" button).
export function recomputePayslip(id: string) {
  const slip = db.select().from(payslips).where(eq(payslips.id, id)).get();
  if (!slip) return;
  const run = db.select().from(payRuns).where(eq(payRuns.id, slip.payRunId)).get();
  const emp = getEmployee(slip.employeeId);
  if (!run || !emp) return;
  const rpn = currentRpn(emp.id, run.taxYear);
  const d = computeDeductions(emp, run.taxYear, run.periodNo, slip.grossPay, rpn);
  updatePayslip(id, {
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

export function setPayRunStatus(id: string, status: "draft" | "finalised") {
  db.update(payRuns).set({ status }).where(eq(payRuns.id, id)).run();
}

export function deletePayRun(id: string) {
  db.transaction((trx) => {
    trx.delete(payslips).where(eq(payslips.payRunId, id)).run();
    trx.delete(payRuns).where(eq(payRuns.id, id)).run();
  });
}

// ---- PSR (Payroll Submission Request) export ------------------------------
// Builds a PAYE Modernisation payroll submission following Revenue's PSR
// data-items spec. Validate against ROS before filing live — this is a working
// figure, not a guarantee of a successful submission.

export function buildPsr(payRunId: string, softwareVersion: string) {
  const run = getPayRun(payRunId);
  if (!run) return null;
  const s = db.select().from(settings).where(eq(settings.id, 1)).get();

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
