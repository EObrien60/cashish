# Rule classification

Gives existing rules a posting kind — what the matched transaction *is*, rather
than only how it is labelled.

```sh
set -a; . ./.env.production.local; set +a
npx tsx scripts/rules/classify.ts --tenant obh --commit
npx tsx scripts/rules/classify.ts --tenant quantumharbour --commit
# then apply, so the attribution reaches the transactions
```

Dry run by default. Idempotent.

## How it infers

In order: a rule naming a person is `payroll`; naming a vendor is
`vendor_payment`; mentioning Revenue in **either** direction is `tax` — a refund
from Revenue is still tax, and it books to Other income, so testing the category
name alone missed it; an income rule whose match text names a known customer is
`sales_receipt`; expense spend whose match text names a known vendor becomes
`vendor_payment`. Everything else stays `other`.

Nothing is written that would fail its own validation. A rule that would become
`sales_receipt` without an identifiable customer stays `other` and is printed,
rather than being saved in a state the next edit would reject.

## Payer aliases

`GUSTO` is not a customer — it is how TripleBolt pays. Established from the
invoice totals rather than guessed: Gusto's inflows sum to exactly the €27,000 of
TripleBolt's three export invoices. Name similarity can never find that, so it is
stated in `CUSTOMER_ALIASES`.

The comparison there is deliberately loose. An exact name match found nothing,
because OBH's customer is "TripleBolt Technology LLC" while the alias says
"TripleBolt" — and €35,000 of receipts stayed unattributed as a result.

## Results

| | rules | classified |
|---|---|---|
| QuantumHarbour | 63 | 48 vendor_payment · 7 payroll · 5 sales_receipt · 1 tax · 2 other |
| OBH Software | 30 | 20 vendor_payment · 6 payroll · 4 sales_receipt |

After applying:

| | money in attributed | money out attributed |
|---|---|---|
| QuantumHarbour | €117,393.64 of €120,947.16 | 504 of 534 rows |
| OBH Software | €123,744.50 of €124,679.66 | 165 of 170 rows |

Everything still unattributed is a case where no counterparty is the right
answer: Revenue refunds, director funding, Revolut rewards and fee refunds, and
refunds **from** vendors, which are money in from a supplier rather than revenue.

QuantumHarbour keeps two `other` rules, both correctly:

- `REWARD` — Revolut cashback, which has no counterparty.
- `ETHAN PAUL OBRIEN` inbound — capital introduced. It was offered as `payroll`
  and refused, because a payment *to* a person cannot apply to money coming in.
  That refusal is the validation doing its job.

## A customer created from the bank feed

`Propchain Solutions Limited` in OBH. A Sales rule already treated them as
revenue and €30,750 had arrived across three receipts, so the customer record was
the missing half rather than a guess. There are no invoices on file for them.
