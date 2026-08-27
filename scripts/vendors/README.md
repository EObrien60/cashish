# Vendor setup

Creates vendors and attributes their payments, for both businesses.

```sh
set -a; . ./.env.production.local; set +a
npx tsx scripts/vendors/setup.ts --tenant quantumharbour --commit
npx tsx scripts/vendors/setup.ts --tenant obh --commit
```

Dry run by default; idempotent.

## How it attributes history

Preferred route: attach the vendor to the categorisation rule that already
recognises the name, then re-apply the rules. One pass covers the whole ledger,
and new imports attribute themselves.

Where no rule carries the name — OBH's rule set predates several of its
suppliers — the script attributes the matching outgoing payments **directly**
instead. A vendor that exists and payments that exist should not be left
unconnected because a rule is missing.

## Why the list is written out

Deriving suppliers from bank descriptions sweeps in staff payments, Revenue and
pot transfers. A wrong vendor is more annoying to unpick than a missing one, so
the script prints whatever outgoing payments remain unattributed and leaves the
judgement to a person.

## Results

| | vendors | attributed |
|---|---|---|
| QuantumHarbour | 30 | €60,769.23 |
| OBH Software | 8 | €31,554.53 |

What remains unattributed in both is Revenue and staff — staff are people, not
vendors, and are attributed under Payroll instead — plus a handful of one-off
purchases where a vendor record would be more clutter than help.

Two things worth knowing:

- `Gcid` on OBH's statement is Galway City Innovation District, abbreviated by
  the bank. Both spellings are matched.
- OBH pays Quantum Harbour €11,940.68 across three payments, while Quantum
  Harbour invoiced OBH €11,606.12 on invoices 1051 and 1060. The €334.56
  difference is a third payment with no invoice on file — worth a look.
