# cashish MCP server + integration surface

Three ways for something outside the web app to work with the books.

1. **MCP over HTTP** — `POST /api/mcp`, authenticated with an API key or an
   OAuth token. This is the public surface: add it to Claude Code, a script, or
   claude.ai as a Connector.
2. **MCP over stdio** — `npm run mcp`, for driving one tenant's books from a
   terminal against whatever `DATABASE_URL` names.
3. **Integration summary** — `GET /api/integration/summary`, one aggregate
   payload for Lunar to pull. A *summary*: balances per customer, not line-level
   data.

The tools are defined once, in `mcp/tools.ts`, and both transports register the
same set. Every tool calls the same `src/lib` functions the UI does — nothing
here reimplements a query, a total, invoice numbering, VAT or rule matching.

## Connecting over HTTP

Mint a key (Settings → API keys, or the CLI):

```sh
npm run api-key -- --tenant <slug> --name "claude code" --role accountant
```

The key is shown once. The quickest way to register it with Claude Code:

```sh
claude mcp add --transport http --scope user cashish \
  https://<your-deployment>/api/mcp \
  --header "Authorization: Bearer ck_live_…"
claude mcp list          # expect: cashish … ✔ Connected
```

`--scope user` puts it in your own `~/.claude.json`, available in every project.
Use `--scope local` for one project only. **Do not use `--scope project`**: that
writes to the repository's committed `.mcp.json`, which would commit the key.

Equivalently, by hand:

```json
{
  "mcpServers": {
    "cashish": {
      "type": "http",
      "url": "https://<your-deployment>/api/mcp",
      "headers": { "Authorization": "Bearer ck_live_…" }
    }
  }
}
```

Pick the role to match what you want the agent to be able to do. `accountant` can
work the books but cannot touch settings, people or keys, which is the sensible
default for day-to-day agent use; `owner` can do everything.

One key addresses one business. A second business needs its own key and its own
entry.

### The committed `.mcp.json`

The `.mcp.json` in this repository registers **`cashish-local`** — the stdio
server, against whatever `DATABASE_URL` and `CASHISH_TENANT` your shell provides.
It deliberately contains no credentials, because it is committed. Point it at a
dev or scratch database:

```sh
export DATABASE_URL=postgres://cashish:cashish@127.0.0.1:5470/cashish_dev
export CASHISH_TENANT=<slug>
```

### Roles, not a flag

There is no `CASHISH_MCP_WRITE`. Whether a caller may change the books is
decided by **its own role**, checked through the same capability map
(`src/lib/rbac.ts`) the web UI uses:

| role | can |
|---|---|
| `viewer` | read everything |
| `accountant` | read, and change the books |
| `owner` | that, plus settings, people and keys |

A `viewer` key gets a plain refusal from every write tool, naming the role it
presented. An environment variable could not express this: one deployment serves
several tenants and several credentials, and a read-only key must not become a
writer because the server happened to start with writes enabled.

### OAuth, for clients that cannot hold a key

For claude.ai Connectors and anything else that should not be handed a
long-lived secret, the deployment is also an OAuth 2.1 authorization server.
Point the client at the base URL; it discovers the rest:

```
/.well-known/oauth-protected-resource
/.well-known/oauth-authorization-server
/oauth/register    dynamic client registration
/oauth/authorize   consent, requires a signed-in owner
/oauth/token       code exchange and refresh
```

PKCE (S256) is mandatory. Scopes are `books:read` and `books:write`, and a
token's scopes are intersected with the approving user's role — a viewer cannot
approve a write token.

## Connecting over stdio

```sh
DATABASE_URL=… CASHISH_TENANT=<slug> npm run mcp
CASHISH_MCP_ROLE=viewer npm run mcp      # rehearse what a read-only caller sees
```

The tenant must be named: this talks to a multi-tenant database and "whose
books?" has no default. The role defaults to `owner`, because whoever holds the
connection string already has everything — but it can be lowered to see what a
restricted credential would.

## The tools

**Read** — `cashish_overview`, `cashish_transactions`, `cashish_categories`,
`cashish_rules`, `cashish_test_rule`, `cashish_customers`, `cashish_invoices`,
`cashish_invoice`, `cashish_reconcile`, `cashish_unmatched_inflows`,
`cashish_recurring`, `cashish_reports`, `cashish_integration_summary`.

**Write** — `cashish_save_rule`, `cashish_delete_rule`, `cashish_apply_rules`,
`cashish_categorise`, `cashish_note_transaction`, `cashish_exclude_transactions`,
`cashish_create_customer`, `cashish_update_customer`, `cashish_create_invoice`,
`cashish_match_payment`, `cashish_delete_payment`, `cashish_delete_invoice`,
`cashish_set_invoice_status`, `cashish_save_recurring`,
`cashish_generate_due_recurring`.

### The reconciliation loop

`cashish_reconcile` is the main workflow. It pairs bank inflows nothing has
claimed against invoices still owed, and sorts the result into three buckets:

- **confidentMatches** — amount matches *and* the payer name appears in the
  transaction. Feed these straight to `cashish_match_payment`, which defaults the
  amount and date from the bank line and links the transaction to the payment.
- **needsDecision** — amount or name matches, but not both. Show these before acting.
- **needsInvoice** — money arrived and no open invoice explains it. Either the
  invoice lives in the old system and should be copied in
  (`cashish_create_invoice` with the original `issueDate`), or it was never raised.

`cashish_test_rule` is a dry run: it reports what a rule *would* catch, how many
of those are still uncategorised, and how many another rule already claims —
check it before `cashish_save_rule`.

## Integration summary

`GET /api/integration/summary`, `Authorization: Bearer ck_live_…`. Versioned by
`version` so a consumer can refuse a shape it does not understand.

Authentication is an API key, not a shared token. The previous
`CASHISH_INTEGRATION_TOKEN` identified no tenant, which in a multi-tenant service
cannot answer the only question that matters: whose books? A read-only key is
enough.

Contents: per-customer invoiced/received/outstanding/overdue with the worst
days-overdue, recurring schedules and when they next fall due, org-wide totals,
and a bank block (unmatched inflow count and total, last transaction date,
uncategorised count). No line items, no bank descriptions.

For a file instead of a request:

```sh
npm run export:integration -- --tenant <slug> --out ~/somewhere.json
```

## Working against a scratch database

Never point a test or an experiment at the production `DATABASE_URL`.

```sh
docker exec cashish-dev-pg psql -U cashish -d cashish_dev -c 'create database cashish_scratch;'
DATABASE_URL=postgres://cashish:cashish@127.0.0.1:5470/cashish_scratch npm run db:migrate
DATABASE_URL=postgres://cashish:cashish@127.0.0.1:5470/cashish_scratch npm run seed:scratch
```

`scripts/seed-scratch.ts` refuses to run unless `DATABASE_URL` names a database
containing "scratch" or "test".
