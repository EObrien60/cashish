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
