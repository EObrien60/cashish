# People setup

Creates the people a business pays and links their payments, for QuantumHarbour
and OBH Software.

```sh
set -a; . ./.env.production.local; set +a
npx tsx scripts/people/setup.ts --tenant obh --commit
npx tsx scripts/people/setup.ts --tenant quantumharbour --commit
```

Dry run by default. Idempotent: an existing person is reused and an
already-linked rule is skipped, so re-running only fills gaps.

## How it links a year of payments in one pass

Both businesses already had categorisation rules matching each name — that is how
the payments were booked to Wages & salaries in the first place. The script
attaches the employee to that same rule and then re-applies the rules across the
whole ledger, so the history backfills without touching transactions one at a
time. New imports link themselves from then on.

## Why the list is written out rather than derived

A pattern like `To <Name> <Name>` matches `To Buzzworks Design Studio LTD` and
`To Hetzner Online GmbH` exactly as well as a person. Putting a supplier on the
payroll is wrong in a way that is tedious to unpick, so the people are listed
explicitly. The script prints whatever is left that looks name-shaped, and in both
businesses everything remaining is a company — which is the check that the list is
complete.

## The director appears on both sides

Money goes out to the director and the director also puts money in. Both are
linked to the same person, and the two are reported separately: `paid` counts
outflows only. Summing absolute values would have shown QuantumHarbour's director
as having been paid €14,723.64 rather than €13,526.12 plus €1,197.52 put in.

## Results

| | people | attributed |
|---|---|---|
| OBH Software | 6 | €17,975.75 |
| QuantumHarbour | 7 | €36,359.12 |

Nobody has a payslip or an RPN, and none of the above needed one.

Whether each person is an employee or a contractor is still an open question —
it changes how the payment is taxed, and the categories were left exactly as they
were. Xinyu Zhang (17 payments, €20,364) and Sarah Jane Hughes (8 payments,
€11,880) are the two that matter most.
