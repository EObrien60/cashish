/**
 * Hourly pay.
 *
 * An hourly employee's gross is hours × the rate snapshotted onto the payslip
 * when the run was created. Entering hours has to re-run the RPN calc, or the
 * deductions stay those of a €0 slip. Salaried slips must not notice any of it.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { asTenant, makeTenant, closePool } from "./harness";
import {
  saveEmployee,
  createPayRun,
  getPayRun,
  recomputePayslip,
  setPayslipHours,
  grossFromHours,
  type EmployeeInput,
} from "../src/lib/payroll";

let tid = "";
before(async () => {
  tid = (await makeTenant("hourly")).id;
});
after(closePool);

const base: Omit<EmployeeInput, "firstName" | "familyName"> = {
  ppsn: "",
  employerReference: "",
  employmentId: "1",
  dob: null,
  addressLine1: "",
  addressLine2: "",
  city: "",
  email: "",
  startDate: null,
  dateOfLeaving: null,
  director: "",
  payFrequency: "Monthly",
  standardGross: 0,
  pensionEmployeePct: 0,
  prsiClass: "A",
  status: "active",
  payBasis: "salary",
  hourlyRate: 0,
};

test("gross from hours rounds to the cent", () => {
  assert.equal(grossFromHours(37.5, 15.333), 574.99);
  assert.equal(grossFromHours(10.25, 13.5), 138.38);
  assert.equal(grossFromHours(0, 20), 0);
});

test("an hourly slip starts at zero hours with the rate snapshotted, and hours drive gross and deductions", () =>
  asTenant(tid, async () => {
    await saveEmployee({ ...base, firstName: "Hana", familyName: "Hourly", payBasis: "hourly", hourlyRate: 20 });
    await saveEmployee({ ...base, firstName: "Sal", familyName: "Salaried", standardGross: 3000 });
    const runId = await createPayRun(2026, 3, "2026-03-31");
    const run = (await getPayRun(runId))!;
    const hourly = run.slips.find((s) => s.employee.firstName === "Hana")!;
    const salaried = run.slips.find((s) => s.employee.firstName === "Sal")!;

    assert.equal(hourly.hours, 0);
    assert.equal(hourly.hourlyRate, 20);
    assert.equal(hourly.grossPay, 0);

    await setPayslipHours(hourly.id, 100);
    const after = (await getPayRun(runId))!.slips.find((s) => s.id === hourly.id)!;
    assert.equal(after.hours, 100);
    assert.equal(after.grossPay, 2000);
    assert.equal(after.employeePrsi, 84); // 4.2% class A — proves deductions were recomputed
    assert.equal(after.employerPrsi, 178);
    assert.equal(after.netPay, 2000 - after.incomeTaxPaid - after.uscPaid - after.employeePrsi - after.lptDeducted);

    // Salaried: untouched by any of it, and recompute keeps its gross.
    assert.equal(salaried.hours, 0);
    assert.equal(salaried.hourlyRate, 0);
    assert.equal(salaried.grossPay, 3000);
    await recomputePayslip(salaried.id);
    const sal2 = (await getPayRun(runId))!.slips.find((s) => s.id === salaried.id)!;
    assert.equal(sal2.grossPay, 3000);
    assert.equal(sal2.employeePrsi, 126);
  }));
