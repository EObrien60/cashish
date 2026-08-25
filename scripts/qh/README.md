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

## Known gaps

- **Invoices 1014–1050 and 1065 are not in the PDFs.** They are almost
  certainly why 39 inflows (€47,983.45) are categorised as Sales but cannot be
  linked to an invoice, and why several large J Ryan Haulage inflows exceed any
  single open invoice. Supply those documents and re-run step 4.
- Eight invoices remain open (€12,483.25, of which €8,744.05 overdue), all J
  Ryan Haulage. Seven are marked PAID on their PDF — see above.
- Rules marked `[confirm]` in the script output are inferences, not facts read
  off a document. The people-payment and owner-payment ones matter most, because
  wages, contractor fees and director's drawings are taxed differently.
