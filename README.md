# cashish

Lightweight accounting for a one-person Irish business. Built to replace the
bits of QuickBooks that actually get used: **bank statement import, invoicing
with a product library, reporting, and a cash-basis VAT return** — minus the
subscription.

- **EUR only**, **Ireland**, **cash receipts basis** VAT.
- Local-first: a single SQLite file (`cashish.db`), no accounts, no cloud, no
  monthly fee. Runs on your machine.
- DB access is isolated behind Drizzle (`src/db/client.ts`), so swapping SQLite
  for Postgres later is a driver change, not a rewrite.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. On first boot the database file and tables are
created automatically and seeded with Irish VAT rates and a starter chart of
categories. Nothing else to configure.

First stop: **Settings** → put in your business name, VAT number and IBAN so
invoices look right.

## What's in it

### Transactions
Upload a Revolut Business CSV on the **Transactions** page. Each row carries the
provider's transaction `ID`, so **re-uploading an overlapping statement is
safe** — cashish matches on that ID and only imports transactions it hasn't seen
before. Categorise transactions (inline or in bulk) and tag VAT where relevant;
this is what feeds the reports and VAT return.

### Invoicing
A QBO-style **product/service library** (`Products`) gives you reusable line
items with a price and VAT rate. Build invoices by pulling those in or typing
custom lines, with live VAT/total calculation. Invoices print to a clean PDF
(use your browser's *Print → Save as PDF*). Record payments against them — the
status (sent → partial → paid) updates itself, and overdue invoices flag
automatically.

**Recurring invoices.** Set up a schedule (weekly/monthly/quarterly/yearly, with
an optional end date or invoice count) for retainers and subscriptions. Because
this is a local app with no always-on server, due invoices are generated
*when you open the app*: the Invoices page shows a "ready to generate" banner and
creates them in one click — including catch-up for any periods missed while the
app was closed. Generated invoices are drafts by default, or auto-marked "sent"
per schedule.

### Categorisation rules
Teach cashish to file transactions automatically. A rule matches on a field
(description / reference / payer / MCC / any) with contains / equals / starts-with
/ regex, optionally limited to money-in or money-out, and assigns a category +
VAT rate. Rules run top-to-bottom (first match wins) **on import** and via an
**Apply rules** sweep over existing uncategorised transactions. Manual
categorisations are never overwritten.

### Receipts
Attach images or PDFs to any bank transaction (paperclip column in the ledger).
Files are stored on disk under `data/receipts/` — only metadata lives in the DB,
so the database stays small and you can browse/back-up receipts directly.

### Reports
Profit & loss and monthly cashflow over any period (month, quarter, YTD, last 12
months, all time), broken down by category.

### VAT return
Irish **VAT3** figures on the **cash receipts basis**:

- **T1** — VAT on sales, recognised when customers *pay* their invoices
  (apportioned per payment for part-payments and mixed-rate invoices).
- **T2** — VAT on purchases, taken from bank transactions you've tagged with a
  VAT rate (VAT element extracted from the gross amount).
- **T3 / T4** — net payable to / repayable by Revenue.

Bi-monthly periods by default. It flags untagged expenses so you don't miss
input VAT. It's a working figure to check against your records — not tax advice.

## Tech

Next.js (App Router) · React · TypeScript · Drizzle ORM · better-sqlite3 ·
Tailwind. No external services.

## Data & backups

Everything lives in `cashish.db` in the project root, with receipt files under
`data/receipts/`. Back up by copying both. Delete the DB to start fresh (it's
recreated and reseeded on next boot). Schema upgrades are applied automatically
on boot via a `PRAGMA user_version` migration gate.

### Payroll (Irish PAYE Modernisation)
Monthly payroll for employees and directors, driven by RPNs.

- **Employees** — manage staff and directors (PRSI class, proprietary-director
  flag, default monthly gross, employee pension %).
- **RPN import** — upload the Revenue Payroll Notification (RPN) JSON from ROS.
  cashish matches each RPN to an employee by PPSN / employment ID and reads the
  tax instruction (credits, standard-rate cut-off, USC bands, PRSI class, basis).
  The parser is tolerant of envelope/casing variations in the ROS export.
- **Pay runs** — one per month. A payslip is created for every active employee;
  PAYE (cumulative or week-1), USC (banded) and PRSI (by class) are computed from
  the RPN. This is the **"lighter calc"**: figures are suggested from the RPN and
  are **fully editable** before you finalise. Printable payslips included.
- **PSR export** — download a PAYE Modernisation **Payroll Submission Request
  (PSR)** JSON per run, structured to Revenue's data-items spec.

> Payroll is a working aid, not tax advice. PRSI uses default class rates —
> verify against the current PRSI Employer Guide each year. Cumulative PAYE needs
> prior-period pay recorded (or carried on the RPN) to be correct mid-year.
> **Always validate the PSR in ROS before filing live.** Set your Employer
> Registration Number in Settings first.

## Roadmap

Package the app for desktop ("electronifying").
