# QuantumHarbour build-out

One-off scripts that turned the QuantumHarbour bank feed plus two invoice PDFs
into a set of books. Kept because they document exactly how the numbers got
there, and because they are idempotent — re-running adds only what is missing.

```sh
set -a; . ./.env.production.local; set +a          # or any DATABASE_URL

# 1. parse the PDFs (pdftotext -layout, then a table parser)
pdftotext -layout qh2025inv.pdf /tmp/qh2025.txt
pdftotext -layout qh2026inv.pdf /tmp/qh2026.txt
python3 scripts/qh/parse-invoices.py /tmp/qh2025.txt /tmp/qh2026.txt > scripts/qh/invoices.json

# 2. customers, invoices, rules, exclusions   (--commit to write)
npx tsx scripts/qh/build.ts --tenant quantumharbour --commit

# 3. a second pass of rules for the tail
npx tsx scripts/qh/rules2.ts --tenant quantumharbour --commit

# 4. payments, from real bank lines only
npx tsx scripts/qh/match-payments.ts --tenant quantumharbour --commit

# 5. the product library, from the invoice lines
npx tsx scripts/qh/products.ts --tenant quantumharbour --commit
#    add --with-licences and/or --with-services to widen it

# 6. repair the batch payments mis-allocated by the old one-to-one matcher
npx tsx scripts/qh/repair-batch-payments.ts --tenant quantumharbour --commit
```

Every script defaults to a dry run. `--commit` is required to write.

## What was decided, and why

**Invoice numbers are supplied verbatim.** The series runs 1010–1071 and those
are the numbers on documents customers already hold, so they are used as-is and
the sequence is left alone. It was set to continue at 1072 afterwards.

**Payments come only from bank lines.** Seven invoices are stamped PAID on the
PDF with no inflow that matches them; they are left open rather than settled
with an invented payment. An unlinked payment would make an invoice look paid
while the money still sits in the ledger unexplained — the same figure counted
twice — and cash-basis VAT is driven by payment dates, so a guessed date
corrupts the return.

**Two payer aliases**, both established from the documents rather than assumed:

| bank counterparty | pays for | evidence |
|---|---|---|
| `GUSTO, INC.` | TripleBolt | three inflows totalling exactly the €27,000 of invoices 1057, 1063, 1064 |
| `SAOITHE TEORANTA` | Barrowview Medical Practice | four inflows matching invoices 1012, 1054, 1055, 1056 to the cent |

Saoithe was initially created as a customer and is now archived: it is the
entity that settles Barrowview's invoices, not a customer in its own right.

**Export-rated invoices.** The TripleBolt invoices are 0% — services sold to a
US company, outside the EU — and map to the tenant's `vat-zero` rate. Everything
else is standard 23%.

**Internal movements are excluded, not categorised.** Revolut pot transfers
(`To/From Tax`, `To/From PayrollTax`, `From Euro`) and own-account FX
(`MAIN · EUR → MAIN · GBP`) are counted nowhere, while the rows stay so a
statement still reconciles line for line. 133 rows.

## The product library

`products.ts` aggregates the 88 invoice lines into 40 hardware products, priced
at the **most recent** price charged. Where a price changed over time the full
history goes in the product's description, because a library that silently
averages prices is worse than none.

Software licences (Microsoft Office, Windows Server, RDS CALs) and services
(Managed Services, the Guides Collective work, Datto retention) are deliberately
**not** created by default — whether a licence belongs in a product library
beside monitors is a preference, not a fact. `--with-licences` and
`--with-services` add them.

It also does two things worth knowing about:

- **Refreshes the stored line descriptions.** The invoices were first created
  from a parse that truncated each description at the first wrapped line, so
  "AOC 27P2Q 27\" LED 1080p 75Hz Monitor" was stored as "AOC 27P2Q 27\" LED".
  Lines are matched by (invoice number, sortOrder) and only rewritten when
  quantity, unit price and net amount all still agree — 45 refreshed, 0
  disagreements. No money is written.
- **Links each line to its product**, filling in `product_id`: 60 of 88. The
  other 28 are the service and licence lines.

Three names could not be read reliably by `pdftotext -layout` and are corrected
by an explicit map in the script, taken off the page by eye:

| parsed | actual |
|---|---|
| `G10 15.6" Notebook - 5 - 7535U Win 11 Pro` | `HP 255R G10 15.6" Notebook - AMD Ryzen 5 7535U Win 11 Pro 8GB RAM 256GB SSD` |
| `HP ProDesk 2 SFF` | `HP ProDesk 2 SFF G1iEi5 1350016GB/256GB PC` |
| `AOC 27" Monitor` | same item as `AOC 27P2Q 27" LED 1080p 75Hz Monitor` — merged |

## J Ryan Haulage pays in batches

Step 6 exists because of a wrong inference recorded here earlier. Eight J Ryan
Haulage invoices showed as open (€12,483.25) and this file blamed the missing
1014–1050 PDFs. The arithmetic says otherwise: the twelve invoices on file
excluding the newest come to **€39,220.99**, and **€39,220.90** arrived. They were
square all along, bar nine cent.

They settle a month at a time — that month's retainer plus whatever else was
outstanding — in one transfer:

| transfer | settles |
|---|---|
| 2025-07-30 €3,669.00 | 1010 + 1011 + 1013 (nine cent short) |
| 2025-08-27 €2,170.95 | 1052 + 1053 |
| 2025-10-02 €2,904.01 | 1058 + 1059 |
| 2025-11-26 €1,525.20 | 1061 |
| 2025-12-17 €1,525.20 | 1062 |

The old matcher bound one bank line to at most one invoice, so no batch could ever
match. Worse, because the retainers are identical, the two lone €1,525.20 transfers
were handed to the *oldest* unclaimed retainer — 1013 and 1053, both already paid by
the July and August batches — and the invoices they really settled, 1061 and 1062,
were left looking open. Nothing reported an error; the ledger was just wrong.

`src/lib/reconcile.ts` now proposes batches, and step 6 converts the old allocation.
It states the expected plan and refuses to write if the matcher proposes anything
else, recognises an already-repaired ledger and stops, and will not touch a payment
whose bank line settles more than one invoice. Dry run by default.

After it: only **1071** (€3,739.20, raised 2026-07-26) is outstanding, plus nine cent
stranded on 1013 — a genuine short payment, since 1010's total of €1,375.14 is
€1,118 × 1.23 exactly.

## Known gaps

- **Invoices 1014–1050 and 1065 are not in the PDFs.** This is why a number of
  2024-era inflows are categorised as Sales with no invoice to link them to. It is
  *not* why the J Ryan Haulage invoices looked open — see above.
- Seven invoices are stamped PAID on their PDF with no inflow that matches them.
  Left open rather than settled with an invented payment.
- Rules marked `[confirm]` in the script output are inferences, not facts read
  off a document. The people-payment and owner-payment ones matter most, because
  wages, contractor fees and director's drawings are taxed differently.
