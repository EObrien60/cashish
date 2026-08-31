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

An npm workspace. `@cashish/core` holds everything a second application would
otherwise have to duplicate; the domain stays in the app that owns it.

```
packages/core/               @cashish/core — imported by every app
  src/db/schema.ts           every table, for the whole deployment
  src/db/client.ts           the only DB coupling (lazy pool)
  src/db/context.ts          tenant AsyncLocalStorage
  src/db/index.ts            the "@cashish/core/db" entry point
  src/rbac.ts                roles and capabilities
  src/migrate.ts             the migrator, callable; scripts/migrate.ts wraps it
  drizzle/                   generated migrations — never edited by hand

apps/admin/                  the platform admin console
  src/lib/admin-auth.ts      platform_admins: passwords, authenticate
  src/lib/admin-session.ts   its own cookie and its own signing secret
  src/lib/audit.ts           withAudit — mutation and record in one transaction
  src/queries/               cross-tenant reads, deliberately outside runInTenant
  scripts/create-admin.ts    the only way an administrator comes to exist

apps/books/                  the accounting app
  src/db/seed.ts             per-tenant seed (VAT rates, categories) — domain
  src/lib/                   the domain: transactions, rules, invoices, reconcile,
                             vat, reports, recurring, payroll, integration,
                             receipts, plus auth, session, oauth, request-context
  src/app/                   pages, server actions, API routes
  src/components/            React components, client and server
  src/middleware.ts          the session gate (must live under src/, not app root)
  mcp/                       tools.ts (one definition), stdio.ts (local transport)
  scripts/                   bootstrap, cloud-import, api-key, set-password
  tests/                     node:test against real Postgres
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

Every command below runs from the repository root and delegates to the right
workspace; add `-w @cashish/books` or `-w @cashish/core` to target one directly.

| command | what it does |
|---|---|
| `npm run dev` / `build` / `start` | the usual Next.js three, on `apps/books` |
| `npm test` | the suite, against `cashish_test` |
| `npm run db:generate` | generate a migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | apply pending migrations |
| `npm run bootstrap -- …` | create the first tenant and its owner |
| `npm run cloud:import -- --from <sqlite> --tenant <slug>` | import a legacy SQLite book, verified |
| `npm run api-key -- --tenant <slug> --name … --role …` | mint an API key |
| `npm run add-member -- --tenant <slug> --email … --role …` | grant someone access without an invite link |
| `npm run set-password -- --email … --password …` | rotate a password |
| `npm run mcp` | MCP over stdio (needs `CASHISH_TENANT`) |
| `npm run dev:admin` / `build:admin` / `test:admin` | the admin console |
| `npm run admin:create -w @cashish/admin -- --email … --password …` | create a platform administrator (the `-w` form is required; a root alias cannot forward the flags through two npm hops) |

### Environment

| variable | required | notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres. In production, Neon's **pooled** endpoint. |
| `AUTH_SECRET` | yes | ≥32 chars; `openssl rand -base64 48`. Distinct per environment. |
| `APP_URL` | production | public origin; OAuth metadata and invite links depend on it |
| `BLOB_READ_WRITE_TOKEN` | for receipts | absent locally ⇒ blobs fall back to `./data/blobs`. The store must be created with **private** access; a public one rejects the writes. |
| `CASHISH_TENANT` | for `npm run mcp` | tenant slug the stdio server serves |
| `ADMIN_AUTH_SECRET` | for `apps/admin` | ≥32 chars, and it **must differ from `AUTH_SECRET`** — the console refuses to start otherwise |
| `CASHISH_ALLOW_PREVIEW_DB` | no | confirms a preview deployment has its own database |

## Conventions specific to this repo

**Every query is tenant-scoped, and the tenant comes from context.** `src/lib/*`
reads it via `tenantId()` from `@cashish/core/db`, which **throws** when there
is no tenant in scope. That is deliberate: a query outside a request fails loudly
rather than quietly reading every book in the database. Entry points establish
the context with `withTenant` / `withCapability` (`src/lib/request-context.ts`)
or `runInTenant` (routes, MCP, scripts). Isolation is enforced here, not by
Postgres RLS, so `tests/tenancy.test.ts` is load-bearing — keep it passing.

**Pages do not query the database directly.** Reference reads go through
`src/lib/lookups.ts`. A page that builds its own query is a page that can forget
the tenant filter.

**Permissions live in exactly one place:** the capability map in
`packages/core/src/rbac.ts`, imported as `@cashish/core/rbac`. Use `requireCapability` / `can`, never an inline role check.
The MCP tools consult the same map, which is what makes "a viewer API key cannot
write" true by construction.

**Money is `double precision`; dates and timestamps are `text`.** Both are
deliberate. `numeric` is the correct type for money and is a tracked follow-up,
but drizzle returns it as a string, which would ripple through every total. Dates
are compared lexicographically as ISO strings throughout the query layer, so
`timestamptz` would silently change reconciliation, VAT periods and recurring
due dates.

**`@cashish/core`'s `client.ts` is lazy on purpose.** `next build` imports every route
module to read its config, so a connection — or a thrown "DATABASE_URL is not
set" — at module scope makes the build require a database it never queries.

**The admin console shares the schema and nothing else.** `apps/admin` must
never import from `apps/books`: everything there assumes a tenant context, and
the console deliberately runs without one. Its queries use `db` directly and
select counts and dates — never a transaction, invoice or payslip row, because
a support question does not require reading somebody's ledger.
`apps/admin/tests/boundaries.test.ts` fails if that slips.

**Platform administrators are not users.** A separate table, a separate cookie
and a separate signing secret, with no self-serve route in. Sharing either the
table or the secret would mean a stolen customer session is an administrator
session, so `admin-session.ts` refuses to start when the two secrets match.

**Plan limits are all no-ops while `BILLING_LIVE` is false.** That is what lets
`src/lib/limits.ts` exist without changing anything for anyone using cashish
today; `apps/books/tests/plan-limits.test.ts` asserts it first, deliberately.
Prices and limits live in the `plans` table, and both the pricing page and the
enforcement read it, so the site cannot advertise a limit nothing applies.

**The schema lives in `packages/core`, and only there.** Both the books app
and anything added later import `@cashish/core/db`; no app declares a table. One
database has one schema and one migration journal, and a schema copied into an
app is a schema that drifts on the first migration somebody forgets to mirror.

**Migrations only.** No DDL at request time. Edit
`packages/core/src/db/schema.ts`, then `npm run db:generate`, and commit the
generated SQL. The migrator resolves its folder against its own module rather
than the working directory — drizzle treats a folder that is not there as
"nothing pending", so a cwd-relative path would report success and apply
nothing.

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
