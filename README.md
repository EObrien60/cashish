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

Everything lives in `cashish.db` in the project root. Back it up by copying that
file. Delete it to start fresh (it'll be recreated and reseeded on next boot).
