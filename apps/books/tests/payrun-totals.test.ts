/**
 * The three numbers at the top of a pay run.
 *
 * Employer PRSI is not part of gross, so a run's real cost is gross plus
 * employer PRSI. Revenue gets every tax line from both sides: PAYE, USC, LPT,
 * employee PRSI and employer PRSI.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { payRunTotals } from "../src/lib/payrun-totals";

const slip = (o: Partial<Parameters<typeof payRunTotals>[0][number]> = {}) => ({
  grossPay: 0,
  incomeTaxPaid: 0,
  uscPaid: 0,
  employeePrsi: 0,
  employerPrsi: 0,
  pensionEmployee: 0,
  lptDeducted: 0,
  otherDeductions: 0,
  netPay: 0,
  ...o,
});

test("total cost includes employer PRSI on top of gross", () => {
  const t = payRunTotals([
    slip({ grossPay: 3000, incomeTaxPaid: 400, uscPaid: 80, employeePrsi: 123, employerPrsi: 334.5, lptDeducted: 20, netPay: 2377 }),
    slip({ grossPay: 1000.1, employerPrsi: 88.2, netPay: 1000.1 }),
  ]);
  assert.equal(t.gross, 4000.1);
  assert.equal(t.totalCost, 4422.8);
  assert.equal(t.netToEmployees, 3377.1);
  assert.equal(t.netToRevenue, 1045.7);
});

test("pension and other deductions are cost but go to neither side", () => {
  const t = payRunTotals([
    slip({ grossPay: 2000, pensionEmployee: 100, otherDeductions: 50, employerPrsi: 200, netPay: 1850 }),
  ]);
  assert.equal(t.totalCost, 2200);
  assert.equal(t.netToEmployees + t.netToRevenue + t.elsewhere, t.totalCost);
  assert.equal(t.elsewhere, 150);
});

test("an empty run is all zeros", () => {
  const t = payRunTotals([]);
  assert.deepEqual([t.totalCost, t.netToEmployees, t.netToRevenue], [0, 0, 0]);
});
