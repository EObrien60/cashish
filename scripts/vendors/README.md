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

## Auditing the gap

```sh
npx tsx scripts/vendors/setup.ts --tenant obh --audit
```

Lists expense rules that attribute money to neither a vendor nor a person, and
any rule matching nothing at all. This exists because the gap is otherwise
invisible: a rule can categorise spend perfectly and still leave the vendor list
short, and nobody notices until they count. The first pass here left 15 such
rules in OBH and 14 in QuantumHarbour. Both are now zero.

## Results

| | vendors | attributed |
|---|---|---|
| QuantumHarbour | 44 | €79,328.81 |
| OBH Software | 22 | €50,410.23 |

Revenue Commissioners is included as a vendor. It is not a supplier, but it is
the single largest outflow in both businesses, and leaving it out meant the
vendor list could not account for where most of the money went. The category
still says Taxes & Revenue, so nothing is misclassified. The Revenue Sheriff is
a separate vendor from Revenue itself, because it is a separate payee — and a
sheriff payment means enforcement.

What remains unattributed is staff, who are people rather than vendors and are
attributed under Payroll instead, plus own-account currency transfers and a few
genuine one-offs.

Two things worth knowing:

- `Gcid` on OBH's statement is Galway City Innovation District, abbreviated by
  the bank. Both spellings are matched.
- OBH pays Quantum Harbour €11,940.68 across three payments, while Quantum
  Harbour invoiced OBH €11,606.12 on invoices 1051 and 1060. The €334.56
  difference is a third payment with no invoice on file — worth a look.
