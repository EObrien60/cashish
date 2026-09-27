import { round2 } from "./format";

type SlipAmounts = {
  grossPay: number;
  incomeTaxPaid: number;
  uscPaid: number;
  employeePrsi: number;
  employerPrsi: number;
  pensionEmployee: number;
  lptDeducted: number;
  otherDeductions: number;
  netPay: number;
};

// Totals for a pay run. Employer PRSI sits on top of gross, so the run's real
// cost is gross + employer PRSI. That cost splits three ways: net pay to the
// employees, every tax line to Revenue, and pension/other deductions to
// whoever they are owed to.
export function payRunTotals(slips: SlipAmounts[]) {
  const sum = (f: (s: SlipAmounts) => number) => round2(slips.reduce((a, s) => a + f(s), 0));
  const gross = sum((s) => s.grossPay);
  const paye = sum((s) => s.incomeTaxPaid);
  const usc = sum((s) => s.uscPaid);
  const eePrsi = sum((s) => s.employeePrsi);
  const erPrsi = sum((s) => s.employerPrsi);
  const lpt = sum((s) => s.lptDeducted);
  return {
    gross,
    paye,
    usc,
    eePrsi,
    erPrsi,
    lpt,
    totalCost: round2(gross + erPrsi),
    netToEmployees: sum((s) => s.netPay),
    netToRevenue: round2(paye + usc + eePrsi + erPrsi + lpt),
    elsewhere: sum((s) => s.pensionEmployee + s.otherDeductions),
  };
}
