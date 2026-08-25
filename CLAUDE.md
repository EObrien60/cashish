# cashish

Lightweight EUR accounting for a small Irish business — bank statements,
categorisation rules, invoicing, cash-basis VAT and PAYE payroll. Multi-tenant,
deployed on Vercel with Neon Postgres, reachable both as a web app and as an MCP
server.

## Stack

| | |
|---|---|
| Framework | Next.js 15 (App Router, React 19), server components + server actions |
| Database | Postgres — Neon in production, a container in dev and test |
| Query layer | drizzle-orm over `pg` (`drizzle-orm/node-postgres`) |
| Auth | email + password, scrypt via `node:crypto`, signed session cookie (`jose`) |
| Machine access | API keys, and an OAuth 2.1 authorization server |
| Agent surface | MCP over stdio and Streamable HTTP (`@modelcontextprotocol/sdk`) |
| Blobs | Vercel Blob (private) for receipt attachments |
| Styling | Tailwind |

## Directory map

```
src/db/          schema.ts (drizzle), client.ts (the only DB coupling),
                 context.ts (tenant AsyncLocalStorage), seed.ts (per-tenant seed)
src/lib/         the domain: transactions, rules, invoices, reconcile, vat,
                 reports, recurring, payroll, integration, receipts
                 plus auth.ts, session.ts, rbac.ts, oauth.ts, request-context.ts
src/app/         pages, server actions (actions.ts, auth-actions.ts), API routes
src/components/  React components, client and server
src/middleware.ts  the session gate (must live under src/, not the repo root)
mcp/             tools.ts (one definition), stdio.ts (local transport)
scripts/         migrate, bootstrap, cloud-import, api-key, set-password, seed-scratch
drizzle/         generated migrations — never edited by hand
tests/           node:test against real Postgres
```

## Running it

Postgres is required; there is no embedded database.

```sh
docker run -d --name cashish-dev-pg \
  -e POSTGRES_PASSWORD=cashish -e POSTGRES_USER=cashish -e POSTGRES_DB=cashish_dev \
  -p 5470:5432 postgres:17
docker exec cashish-dev-pg psql -U cashish -d cashish_dev -c 'create database cashish_test;'

cp .env.example .env.local          # then fill AUTH_SECRET
npm install
npm run db:migrate
npm run bootstrap -- --slug dev --name "Dev Books" \
  --email you@example.com --password 'at-least-twelve-chars'
npm run dev
```

| command | what it does |
|---|---|
| `npm run dev` / `build` / `start` | the usual Next.js three |
| `npm test` | the suite, against `cashish_test` |
| `npm run db:generate` | generate a migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | apply pending migrations |
| `npm run bootstrap -- …` | create the first tenant and its owner |
| `npm run cloud:import -- --from <sqlite> --tenant <slug>` | import a legacy SQLite book, verified |
| `npm run api-key -- --tenant <slug> --name … --role …` | mint an API key |
| `npm run mcp` | MCP over stdio (needs `CASHISH_TENANT`) |

### Environment

| variable | required | notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres. In production, Neon's **pooled** endpoint. |
| `AUTH_SECRET` | yes | ≥32 chars; `openssl rand -base64 48`. Distinct per environment. |
| `APP_URL` | production | public origin; OAuth metadata and invite links depend on it |
| `BLOB_READ_WRITE_TOKEN` | for receipts | absent locally ⇒ blobs fall back to `./data/blobs` |
| `CASHISH_TENANT` | for `npm run mcp` | tenant slug the stdio server serves |
| `CASHISH_ALLOW_PREVIEW_DB` | no | confirms a preview deployment has its own database |

## Conventions specific to this repo

**Every query is tenant-scoped, and the tenant comes from context.** `src/lib/*`
reads it via `tenantId()` from `src/db/context.ts`, which **throws** when there
is no tenant in scope. That is deliberate: a query outside a request fails loudly
rather than quietly reading every book in the database. Entry points establish
the context with `withTenant` / `withCapability` (`src/lib/request-context.ts`)
or `runInTenant` (routes, MCP, scripts). Isolation is enforced here, not by
Postgres RLS, so `tests/tenancy.test.ts` is load-bearing — keep it passing.

**Pages do not query the database directly.** Reference reads go through
`src/lib/lookups.ts`. A page that builds its own query is a page that can forget
the tenant filter.

**Permissions live in exactly one place:** the capability map in
`src/lib/rbac.ts`. Use `requireCapability` / `can`, never an inline role check.
The MCP tools consult the same map, which is what makes "a viewer API key cannot
write" true by construction.

**Money is `double precision`; dates and timestamps are `text`.** Both are
deliberate. `numeric` is the correct type for money and is a tracked follow-up,
but drizzle returns it as a string, which would ripple through every total. Dates
are compared lexicographically as ISO strings throughout the query layer, so
`timestamptz` would silently change reconciliation, VAT periods and recurring
due dates.

**`src/db/client.ts` is lazy on purpose.** `next build` imports every route
module to read its config, so a connection — or a thrown "DATABASE_URL is not
set" — at module scope makes the build require a database it never queries.

**Migrations only.** No DDL at request time. Edit `src/db/schema.ts`, then
`npm run db:generate`, and commit the generated SQL.

**`src/middleware.ts` must stay under `src/`.** Next.js looks for it beside the
app directory; at the repository root it is silently ignored, and the session
gate stops working without any error. It must also stay free of `node:*`
imports — that is why the session cookie name has its own module.

## Testing

`node:test` against real Postgres, a fresh tenant per file. Same engine as
production: testing on a different one is how a rounding or boolean bug ships.

Beyond the domain suites, three are structural and should be treated as
guardrails rather than examples: `tenancy.test.ts` (cross-tenant isolation),
`rbac.test.ts` (the whole role matrix, so a silent widening is visible), and
`oauth.test.ts` (code replay, PKCE, scope capping, refresh rotation).

## The MCP surface

One tool definition (`mcp/tools.ts`), two transports: stdio for a local agent,
Streamable HTTP at `POST /api/mcp` for the deployment. Writes gate on the
caller's role, not on an environment variable. See `mcp/README.md`.
