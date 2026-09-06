import ExcelJS from "exceljs";
import type { CashflowForecast } from "./cashflow";

// ---------------------------------------------------------------------------
// The forecast as a workbook.
//
// Kept apart from cashflow.ts so the numbers can be computed, tested and shown
// on screen without loading a spreadsheet library — the page renders the same
// forecast as HTML, and only the download pays for ExcelJS.
//
// Cells carry NUMBERS, never preformatted strings. The whole point of handing
// someone a sheet rather than a PDF is that they can extend it: add the
// contract income that is not in the books yet, and the totals below have to
// move with it. So the totals, the net and the closing balance are FORMULAS,
// and the accounting number format is what renders a negative as (€1,500.00)
// in red rather than a minus sign that has to be parsed back out.
// ---------------------------------------------------------------------------

/** Accounting-style: € aligned, negatives in red parentheses, zero as a dash. */
const MONEY_FORMAT =
  '_-"€"* #,##0.00_-;[Red]_-"€"* (#,##0.00);_-"€"* "-"??_-;_-@_-';

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD9D9D9" },
};

const SECTION_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF2F2F2" },
};

export function cashflowFilename(forecast: CashflowForecast, businessName: string): string {
  const slug = businessName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug || "cashflow"}-forecast-${forecast.from}-to-${forecast.to}.xlsx`;
}

export async function cashflowWorkbook(
  forecast: CashflowForecast,
  businessName: string,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "cashish";
  wb.created = new Date();

  const ws = wb.addWorksheet("Cash flow", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 1 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const monthCount = forecast.months.length;
  const lastColumn = monthCount + 1; // column A holds the labels

  ws.columns = [
    { width: 34 },
    ...forecast.months.map(() => ({ width: 15 })),
  ];

  const money = (row: ExcelJS.Row) => {
    for (let c = 2; c <= lastColumn; c++) row.getCell(c).numFmt = MONEY_FORMAT;
    return row;
  };

  const label = (row: ExcelJS.Row, bold: boolean) => {
    if (bold) row.font = { bold: true };
    return row;
  };

  // eachCell stops at the last cell that holds a value, so a section heading
  // would otherwise be shaded in column A alone.
  const across = (row: ExcelJS.Row, apply: (cell: ExcelJS.Cell) => void) => {
    for (let c = 1; c <= lastColumn; c++) apply(row.getCell(c));
    return row;
  };

  // --- header ---------------------------------------------------------------
  const header = ws.addRow(["", ...forecast.months.map((m) => m.label)]);
  header.font = { bold: true };
  header.alignment = { horizontal: "right" };
  header.getCell(1).alignment = { horizontal: "left" };
  across(header, (cell) => {
    cell.fill = HEADER_FILL;
    cell.border = { bottom: { style: "thin" } };
  });

  // --- opening balance ------------------------------------------------------
  // Only the first month is a value. Every later month is "what last month
  // closed at", as a formula, so editing a line above updates the run.
  // The later months are filled in once the closing row's number is known.
  const balanceRow = ws.addRow(["Balance", forecast.openingBalance]);
  money(label(balanceRow, true));

  // --- income ---------------------------------------------------------------
  const incomeHeading = ws.addRow(["Income"]);
  label(incomeHeading, true);
  across(incomeHeading, (cell) => (cell.fill = SECTION_FILL));

  const incomeFirstRow = ws.rowCount + 1;
  for (const line of forecast.income) {
    money(ws.addRow([line.label, ...line.amounts]));
  }
  // A blank row so a person can insert their own income lines inside the SUM
  // range instead of having to repair the totals afterwards.
  money(ws.addRow([""]));
  const incomeLastRow = ws.rowCount;

  const totalIncomeRow = ws.addRow(["Total Income"]);
  for (let c = 2; c <= lastColumn; c++) {
    const col = ws.getColumn(c).letter;
    totalIncomeRow.getCell(c).value = {
      formula: `SUM(${col}${incomeFirstRow}:${col}${incomeLastRow})`,
    };
  }
  money(label(totalIncomeRow, true));
  const totalIncomeRowNumber = totalIncomeRow.number;

  // --- expenses -------------------------------------------------------------
  const expensesHeading = ws.addRow(["Expenses"]);
  label(expensesHeading, true);
  across(expensesHeading, (cell) => (cell.fill = SECTION_FILL));

  const expenseFirstRow = ws.rowCount + 1;
  for (const line of forecast.expenses) {
    money(ws.addRow([line.label, ...line.amounts]));
  }
  money(ws.addRow([""]));
  const expenseLastRow = ws.rowCount;

  const totalExpensesRow = ws.addRow(["Total Expenses"]);
  for (let c = 2; c <= lastColumn; c++) {
    const col = ws.getColumn(c).letter;
    totalExpensesRow.getCell(c).value = {
      formula: `SUM(${col}${expenseFirstRow}:${col}${expenseLastRow})`,
    };
  }
  money(label(totalExpensesRow, true));
  const totalExpensesRowNumber = totalExpensesRow.number;

  // --- net and closing ------------------------------------------------------
  const netRow = ws.addRow(["Net Income"]);
  for (let c = 2; c <= lastColumn; c++) {
    const col = ws.getColumn(c).letter;
    netRow.getCell(c).value = {
      formula: `${col}${totalIncomeRowNumber}+${col}${totalExpensesRowNumber}`,
    };
  }
  money(label(netRow, true));

  const closingRow = ws.addRow(["Closing Balance"]);
  for (let c = 2; c <= lastColumn; c++) {
    const col = ws.getColumn(c).letter;
    closingRow.getCell(c).value = {
      formula: `${col}${balanceRow.number}+${col}${netRow.number}`,
    };
  }
  money(label(closingRow, true));
  across(closingRow, (cell) => {
    cell.border = { top: { style: "thin" } };
  });

  // Each month after the first opens where the month before it closed.
  for (let i = 1; i < monthCount; i++) {
    const previous = ws.getColumn(i + 1).letter;
    balanceRow.getCell(i + 2).value = { formula: `${previous}${closingRow.number}` };
  }

  // --- provenance -----------------------------------------------------------
  // A forecast without its assumptions written down is a number someone will
  // quote back at you in six months.
  ws.addRow([]);
  const basis =
    forecast.openingBasis === "bank-balance"
      ? `bank balance as at ${forecast.openingAsOf ?? "—"}`
      : `sum of the ledger to ${forecast.openingAsOf ?? "—"}`;
  const notes = [
    `${businessName} — cash flow forecast, ${forecast.from} to ${forecast.to}.`,
    `Opening balance: ${basis}.`,
    "Income is committed money only: what is outstanding on open invoices, in the month it falls due, plus active recurring invoices. Work you have agreed but not invoiced is not in the books, so add it here yourself.",
    `Expenses are outgoings that appeared in at least half of the last ${forecast.lookbackMonths} months, carried forward at the median of those months. Costs that repeat less often than monthly are not projected.`,
    "Totals, net and closing balance are formulas. Insert rows inside a section and they will be included.",
  ];
  for (const note of notes) {
    const row = ws.addRow([note]);
    row.getCell(1).font = { italic: true, size: 9, color: { argb: "FF666666" } };
    row.getCell(1).alignment = { wrapText: false };
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
