# cashish MCP server + integration surface

Two ways for something outside the desktop app to work with the books:

1. **MCP** (`npm run mcp`) — 25 tools over stdio, for an agent to read transactions,
   write rules, build customers and reconcile past payments against invoices.
2. **Integration summary** — one aggregate payload, offered over HTTP and as a file,
   for Lunar to pull as a snapshot. It is a *summary*: balances per customer, not
   line-level data.

Both read whatever `DATABASE_URL` names, defaulting to `./cashish.db`, the same
file the app uses. There is no separate service to run.

## MCP

```
npm run mcp                            # read-only
CASHISH_MCP_WRITE=true npm run mcp     # writes enabled
```

`.mcp.json` registers it for Claude Code with writes **off**. Flip
`CASHISH_MCP_WRITE` to `"true"` there when you want an agent to be able to change
the books.

**Read tools** — `cashish_overview`, `cashish_transactions`, `cashish_categories`,
`cashish_rules`, `cashish_test_rule`, `cashish_customers`, `cashish_invoices`,
`cashish_invoice`, `cashish_reconcile`, `cashish_unmatched_inflows`,
`cashish_recurring`, `cashish_reports`, `cashish_integration_summary`.

**Write tools** — `cashish_save_rule`, `cashish_delete_rule`, `cashish_apply_rules`,
`cashish_categorise`, `cashish_note_transaction`, `cashish_create_customer`,
`cashish_update_customer`, `cashish_create_invoice`, `cashish_match_payment`,
`cashish_set_invoice_status`, `cashish_save_recurring`,
`cashish_generate_due_recurring`.

Every write tool refuses unless `CASHISH_MCP_WRITE=true`, so the default
registration cannot alter anything. The tools call the same `src/lib` functions the
UI does — no second implementation of invoice numbering, VAT or rule matching.

### The reconciliation loop

`cashish_reconcile` is the main workflow. It pairs bank inflows nothing has claimed
against invoices still owed, and sorts the result into three buckets:

- **confidentMatches** — amount matches *and* the payer name appears in the
  transaction. Feed these straight to `cashish_match_payment`, which defaults the
  amount and date from the bank line and links the transaction to the payment.
- **needsDecision** — amount or name matches, but not both. Show these before acting.
- **needsInvoice** — money arrived and no open invoice explains it. Either the
  invoice lives in the old system and should be copied in
  (`cashish_create_invoice` with the original `issueDate`), or it was never raised.

`cashish_test_rule` is a dry run: it reports what a rule *would* catch, how many of
those are still uncategorised, and how many another rule already claims — check it
before `cashish_save_rule`.

## Integration summary

Same payload either way, versioned by `version` so a consumer can refuse a shape it
does not understand.

**HTTP** — `GET /api/integration/summary`, `Authorization: Bearer $CASHISH_INTEGRATION_TOKEN`
(or `?token=`). It fails closed: with `CASHISH_INTEGRATION_TOKEN` unset every
request is a 401, so a dev server never serves the books by accident.

**File** — `npm run export:integration -- --out ~/somewhere.json`. This is the one to
use in practice: cashish is a desktop app, so nothing is listening on a port for
Lunar to call.

Contents: per-customer invoiced/received/outstanding/overdue with the worst
days-overdue, recurring schedules and when they next fall due, org-wide totals, and
a bank block (unmatched inflow count and total, last transaction date, uncategorised
count). No line items, no bank descriptions.

## Working against a scratch database

Never point a test at `cashish.db` — that is the real book.

```
npm run seed:scratch                                    # ./cashish-scratch.db
DATABASE_URL=./cashish-scratch.db npm run mcp
```

`scripts/seed-scratch.ts` refuses to run unless `DATABASE_URL` contains "scratch" or
"test".
