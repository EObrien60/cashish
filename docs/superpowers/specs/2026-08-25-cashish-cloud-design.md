# cashish in the cloud — multi-tenant Vercel + Neon

**Status:** approved design, not yet implemented
**Date:** 2026-08-25
**Source of truth:** this document, until superseded

Cashish today is a single-user, local-first app: synchronous `better-sqlite3`, one
book per file, an Electron shell and a Docker image. This design turns it into a
multi-tenant service on Vercel backed by Neon Postgres, reachable publicly through
both a browser UI (session login, role-based) and an MCP endpoint (API keys or
OAuth 2.1), and migrates the existing book into it.

---

## 1. Verified current state

Measured, not assumed. All figures from the live container `obh-cashish-1`
(`127.0.0.1:3010`, image `obh/cashish:local`, DB at `/data/cashish.db`).

### The live book

Snapshotted via SQLite's backup API on 2026-08-25 12:11 to
`~/cashish-backups/20260825-121129/` (`cashish.db` + `.sql` dump + `SHA256SUMS`).
`pragma integrity_check` → `ok`.

| table | rows |
|---|---|
| transactions | 220 (`2025-04-27` → `2026-08-20`, 220 distinct ids) |
| category_rules | 30 |
| invoices | 14 |
| invoice_lines | 18 |
| payments | 14 |
| customers | 3 |
| categories | 15 |
| vat_rates | 5 |
| settings | 1 |
| products, receipts, employees, payslips, rpns, pay_runs, recurring_invoices, recurring_invoice_lines | 0 |

`user_version` = 4.

### Money totals — the import's acceptance criteria

These exact values must appear in Neon after migration:

| measure | value |
|---|---|
| `sum(transactions.amount)` | **49004.92** |
| `sum(invoices.total)` | **92195.00** |
| `sum(invoices.vat_total)` | **10695.00** |
| `sum(invoices.amount_paid)` | **92195.00** |
| `sum(payments.amount)` | **92195.00** |

### Referential integrity

All ten cross-table relationships checked against the real data: **zero orphans**
(`transactions.category_id`, `transactions.vat_rate_id`, `invoices.customer_id`,
`invoice_lines.invoice_id`, `invoice_lines.product_id`, `invoice_lines.vat_rate_id`,
`payments.invoice_id`, `payments.transaction_id`, `category_rules.category_id`,
`category_rules.vat_rate_id`). Real Postgres foreign keys are therefore safe to add
and will not reject the import.

### What makes the port expensive

| fact | count | consequence |
|---|---|---|
| synchronous `.all()` / `.get()` / `.run()` call sites in `src/lib/*`, `src/db/*`, `src/app/actions.ts` | **163** | every one becomes `await`; callers become async |
| synchronous `db.transaction(cb)` blocks | **10** | become `await db.transaction(async trx => …)` |
| raw `` sql`…` `` fragments | **9** | audited for Postgres syntax; also the tenant-scoping bypass surface (§4) |
| `integer(…, { mode: "boolean" })` columns | **14** | become real `boolean` |
| `src/db/schema.ts` | 420 lines | rewritten `sqliteTable` → `pgTable` |
| `src/db/migrate.ts` DDL | ~250 lines | replaced by drizzle-kit migrations |

### The one interactive transaction

`src/lib/invoices.ts:103-108`, inside `createInvoice`:

```ts
const s = trx.select().from(settings).where(eq(settings.id, 1)).get();
trx.update(settings).set({ nextInvoiceSeq: (s?.nextInvoiceSeq ?? 1) + 1 })…
```

A read-modify-write **inside** the transaction. Two consequences:

1. `drizzle-orm/neon-http` is ruled out — its `transaction()` maps to Neon's batch
   API, which cannot round-trip mid-transaction. The driver must be
   `drizzle-orm/neon-serverless` (WebSocket `Pool`).
2. Single-user on SQLite this was safe. Multi-client it is a duplicate-invoice-number
   race. Fixed in §5.

### Data observation (not a blocker)

`settings.invoice_prefix` = `'INV-'`, `settings.next_invoice_seq` = `15`, but the 14
real invoices are numbered bare `1002`–`1015` — imported with numbers supplied
verbatim, which by design leaves the sequence alone. The next *generated* invoice
would therefore be `INV-0015`, not `1016`. Post-migration the owner should set
`invoice_prefix = ''` and `next_invoice_seq = 1016`. Surfaced to the user, left as
their call. `business_name` is also still the default `'My Business'`.

---

## 2. Decisions

Each was put to the user and chosen explicitly.

| # | decision | rationale |
|---|---|---|
| 1 | **Vercel + Neon Postgres** | chosen over Turso (SQLite dialect, ~3× less work) and a container host with a volume (no refactor at all). User wants real Postgres. |
| 2 | **Multi-tenant** | `tenant_id` in the schema from day one; retrofitting it later is far worse. |
| 3 | **`tenant_id` enforced in the query layer only — no RLS** | user's explicit choice. Concern raised (a raw SQL fragment bypasses the wrapper by construction) and mitigated within the choice, not relitigated: see §4. |
| 4 | **Email + password + invites** | `users` / `memberships` / `invites`; no external identity provider. |
| 5 | **API keys *and* OAuth 2.1** | OAuth is required for claude.ai web Connectors; bearer keys cover Claude Code and scripts. |
| 6 | **Cloud becomes the only book** | one-shot verified import; the local container is stopped afterwards. Two books both accepting writes would diverge. |
| 7 | **Retire Electron and the Dockerfile; Postgres everywhere** | one dialect in dev, test and prod. Testing on SQLite while shipping on Postgres is how a rounding or boolean bug ships unnoticed. |
| 8 | **Money stays `double precision`, not `numeric`** | see below. |

### Why money stays `double precision`

`numeric(14,2)` is the correct type for money and `real` is not. But drizzle returns
`numeric` as a **string**, which ripples into every arithmetic site, every `round2()`
call and every total in the UI. Changing the money representation in the same change
as the dialect, tenancy and auth means any €0.01 discrepancy afterwards is
unattributable.

So: faithful port now (`real` → `double precision`, identical IEEE-754 behaviour,
existing `round2()` semantics preserved), and **`numeric` migration as its own
follow-up** with its own before/after reconciliation. Recorded here so it is not
forgotten, not silently dropped.

### Why timestamps stay TEXT

The schema stores ISO-8601 strings in `text` columns and the query layer relies on
**lexicographic string ordering**: `lte(recurringInvoices.nextRunDate, refISO)`,
`sql\`${invoices.status} in (…)\``, date-range filters on `booked_date`. Converting
to `timestamptz`/`date` would silently change comparison semantics across
reconciliation, VAT periods and recurring-invoice due dates.

All date and timestamp columns therefore stay `text`. `created_at` defaults become:

```sql
to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
```

which reproduces the exact string format `strftime('%Y-%m-%dT%H:%M:%fZ','now')`
produced, so nothing that parses these values changes.

---

## 3. Architecture

```
                    ┌─────────────────────────────── Vercel (Node, Fluid Compute)
  browser ──session cookie──▶ middleware.ts ──▶ pages / server actions ─┐
                              (JWT: uid, tid, role)                     │
                                                                        │
  MCP client ──Bearer ck_live_…──▶ POST /api/mcp ──────────────┐        │
             └─Bearer oauth token─▶ (Streamable HTTP)          │        │
                                                              ▼        ▼
                                                    runInTenant({ tenantId, role })
                                                    AsyncLocalStorage
                                                              │
                                                    src/lib/*  (tenant-scoped)
                                                              │
                                                    src/db/client.ts
                                                    drizzle-orm/neon-serverless
                                                              │
  OAuth client ──▶ /.well-known/*  /oauth/{register,authorize,token}
                                                              ▼
                                                    Neon Postgres
  receipts ─────────────────────────────────────▶  Vercel Blob (private)
```

Every entry point resolves an identity to `{ tenantId, role }`, then runs the request
inside `runInTenant`. `src/lib/*` never receives a tenant argument and never learns
how the caller authenticated.

---

## 4. Tenancy

### Schema changes

- `tenant_id text not null` + index on all 20 domain tables.
- **`transactions` primary key becomes `(tenant_id, id)`.** Its `id` is the bank
  provider's own transaction id, reused so re-imports dedupe naturally; two tenants
  could legitimately import the same id. Dedupe on import becomes per-tenant.
- **Consequence: the two foreign keys pointing at `transactions.id` become
  composite.** `payments.transaction_id` and `receipts.transaction_id` (the only
  referrers) must be declared as
  `foreign key (tenant_id, transaction_id) references transactions (tenant_id, id)`.
  A single-column FK cannot reference a composite primary key, so this is not
  optional — it is the one place the composite PK leaks outside the `transactions`
  table.
- All other domain tables keep a single-column `id` primary key (app-generated uid)
  plus `tenant_id` + index.
- **`settings` loses `id integer primary key` (the single `id = 1` row).** Its primary
  key becomes `tenant_id` — one settings row per tenant.
- `categories` and `vat_rates` become **per-tenant**, seeded when a tenant is created
  rather than on connection open. They are user-editable, so they cannot be global.

### New tables

```
tenants        id, slug (unique), name, created_at
users          id, email (unique), password_hash, created_at
memberships    user_id, tenant_id, role          PK (user_id, tenant_id)
invites        token_hash, tenant_id, email, role, expires_at, accepted_at, created_by
api_keys       id, tenant_id, name, prefix, key_hash, role,
               created_by, created_at, last_used_at, revoked_at
oauth_clients  id, client_id, client_secret_hash, redirect_uris[], name,
               created_at            -- dynamic client registration
oauth_codes    code_hash, client_id, user_id, tenant_id, role, scopes[],
               code_challenge, redirect_uri, expires_at, consumed_at
oauth_tokens   token_hash, kind (access|refresh), client_id, user_id, tenant_id,
               role, scopes[], expires_at, revoked_at
```

### Scoping mechanism — AsyncLocalStorage

Threading a tenant parameter through ~100 functions in `src/lib/*` would be a
miserable, error-prone diff. Instead:

```ts
// src/db/context.ts
type Ctx = { tenantId: string; role: Role; actor: string };
const store = new AsyncLocalStorage<Ctx>();

export function runInTenant<T>(ctx: Ctx, fn: () => Promise<T>): Promise<T> {
  return store.run(ctx, fn);
}

/** Throws if there is no context — a query outside a tenant must fail loudly,
 *  never quietly read every book. */
export function ctx(): Ctx {
  const c = store.getStore();
  if (!c) throw new Error("no tenant context — query attempted outside runInTenant");
  return c;
}
export const tenantId = () => ctx().tenantId;
```

`src/lib/*` keeps its existing signatures; every `where` gains
`eq(table.tenantId, tenantId())` and every insert gains `tenantId: tenantId()`.

**Requires the Node runtime, not Edge.** That is the Vercel default (Fluid Compute).

Entry points that establish context: `middleware.ts` → page wrapper, each server
action, `POST /api/mcp`, each REST route, and each CLI script.

### Mitigating the no-RLS choice

The user chose query-layer enforcement, so the guarantee is only as good as the code.
Two things reduce the surface, both cheap because this code is being rewritten anyway:

1. **Eliminate the bypass surface.** All 9 raw `` sql`…` `` fragments are converted to
   drizzle operators, so no fragment exists that can skip the tenant filter:

   | site | becomes |
   |---|---|
   | `reconcile.ts:59` `` sql`${transactions.amount} >= ${min}` `` | `gte(transactions.amount, min)` |
   | `reconcile.ts:81` `` sql`${invoices.status} in (…)` `` | `inArray(invoices.status, ['draft','sent','partial'])` |
   | `transactions.ts:111,113` `` sql`… IS NULL` `` | `isNull(transactions.categoryId)` |
   | `transactions.ts:195` same | `isNull(...)` |
   | `integration.ts:158` `` sql`${transactions.amount} > 0` `` | `gt(transactions.amount, 0)` |
   | `integration.ts:171` `` sql`… IS NULL` `` | `isNull(...)` |
   | `rules.ts:157` `` sql`${categoryRules.timesApplied} + ${n}` `` | **kept** — an atomic increment with no table reference to scope; the surrounding `where` carries the tenant filter |
   | `schema.ts:19` `strftime(...)` default | `to_char(...)` (§2) |

2. **A cross-tenant isolation test** (`tests/tenancy.test.ts`) seeds two tenants with
   overlapping data and asserts every exported list/report/summary function returns
   only the calling tenant's rows — including `buildIntegrationSummary`,
   `reconcileReport`, `profitAndLoss`, `computeVatReturn` and `dashboardStats`.

---

## 5. Data layer

`src/db/client.ts` is rewritten:

```ts
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

// Module scope: Fluid Compute reuses instances across concurrent requests,
// so the pool is shared rather than rebuilt per invocation.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
```

Removed entirely:

- DDL-on-connection-open (`applySchema`, `SCHEMA_VERSION`, `PRAGMA user_version`)
- seed-on-connection-open (`seedInto` when `vat_rates` is empty)
- the `global.__cashish_db__` singleton
- `src/db/migrate.ts`, `scripts/init-db.ts`, the `prebuild` hook
- `serverExternalPackages: ["better-sqlite3"]` from `next.config.mjs`

Replaced by real **drizzle-kit migrations** in `drizzle/`, generated with
`drizzle-kit generate` and applied by `npm run db:migrate` in the Vercel build
command. Nothing touches the database at request time to set up schema.

### Async conversion

- `.all()` → `await` the query builder.
- `.get()` has no `pg` equivalent → a helper `first()`:
  `const [row] = await q.limit(1); return row ?? null;`
- `.run()` → `await`.
- 10 `db.transaction(cb)` → `await db.transaction(async (trx) => …)`.
- Callers: 12 server actions, ~20 page server components (already permitted to be
  async), all MCP tools (already async).

### Fixing the invoice-number race

The read-modify-write in `createInvoice` is replaced by an atomic increment:

```sql
UPDATE settings
   SET next_invoice_seq = next_invoice_seq + 1
 WHERE tenant_id = $1
RETURNING next_invoice_seq
```

The returned value (minus one) is the number consumed. This removes the race and
also removes the only interactive read inside a transaction — though
`neon-serverless` is retained regardless, since batch-only semantics are a trap to
build on.

### Build-time database access

Every page reading the database gets `export const dynamic = "force-dynamic"`. All of
it is per-tenant data behind auth; none of it should ever be prerendered. This is what
the `prebuild` scratch database existed to work around, so that goes away with it.

---

## 6. Authentication and RBAC

### Sessions

- `middleware.ts` gates everything except `/login`, `/accept-invite/*`, `/api/mcp`
  (own auth), `/.well-known/*`, `/oauth/register`, `/oauth/token`, and static assets.
- **`/oauth/authorize` is deliberately *not* in that exclusion list.** It is the one
  OAuth endpoint that requires a human session (§8), so it stays behind the gate and
  redirects to `/login?next=<original url incl. query>` when no session is present,
  returning the user to the consent screen with the OAuth parameters intact.
  `/oauth/register` and `/oauth/token` are machine endpoints and carry their own
  client credentials.
- Session is a JWT (HS256, `AUTH_SECRET`) in an httpOnly / secure / sameSite=lax
  cookie, payload `{ uid, tid, role, exp }`.
- Tenant switching re-issues the cookie after re-verifying membership. The role in
  the cookie is always the role from the `memberships` row for `(uid, tid)` — never
  client-supplied.
- Passwords: `node:crypto` `scrypt` with a per-user random salt. No dependency.

### Invites

Single-use tokens; only the hash is stored. **There is no email provider in this
project and none is being added** — the owner copies an invite link. If invite email
is wanted later it is a separate change.

### Roles

| capability | owner | accountant | viewer |
|---|---|---|---|
| read books, reports, VAT, reconciliation | ✓ | ✓ | ✓ |
| write transactions, rules, invoices, payments, customers, products | ✓ | ✓ | — |
| import bank statements | ✓ | ✓ | — |
| settings, users, invites, API keys, OAuth clients | ✓ | — | — |
| delete tenant | ✓ | — | — |

Enforced by a **single capability map** plus `requireRole(capability)` called at the
top of every server action and route handler — not scattered `if (role === …)`
checks. The map is the one place the policy lives, and it is what the RBAC test
asserts against.

---

## 7. API keys

- Format `ck_live_<32 random bytes, base64url>`. Displayed **once** at creation,
  never retrievable; only `sha256` and a lookup `prefix` are stored.
- A key carries its own `role`, so a read-only key is expressible.
- Verification: look up by prefix → constant-time hash compare → reject if
  `revoked_at` is set → update `last_used_at`.
- Owner-only management UI: create, name, see last-used, revoke.

---

## 8. MCP over HTTP

### Restructuring

`mcp/server.ts` is 793 lines doing registration, transport and process wiring at once.
It splits:

- `mcp/tools.ts` — `registerTools(server, { role })`, the single definition of all
  ~25 tools, calling `src/lib/*` exactly as today.
- `mcp/stdio.ts` — the local stdio entry point (kept; it is how you drive the cloud
  book from a terminal).
- `src/app/api/mcp/route.ts` — `StreamableHTTPServerTransport` in **stateless** mode
  (serverless holds no cross-request session memory).

### Write gating changes

`CASHISH_MCP_WRITE` is deleted. In a multi-tenant service an env var is the wrong
control — writes gate on **the caller's role**, resolved from their API key or OAuth
token, through the same capability map as the UI (§6). A `viewer` key cannot write no
matter how the server was started.

### Authenticating `/api/mcp`

Accepts either credential and resolves both to the same `{ tenantId, role }`:

- `Authorization: Bearer ck_live_…` → `api_keys` lookup
- `Authorization: Bearer <access token>` → `oauth_tokens` lookup

then `runInTenant(...)`. On failure: `401` with a
`WWW-Authenticate: Bearer resource_metadata="…"` header pointing at the protected-
resource metadata, which is how an MCP client discovers it should start the OAuth flow.

### OAuth 2.1 authorization server

| endpoint | purpose |
|---|---|
| `GET /.well-known/oauth-protected-resource` | advertises the authorization server for `/api/mcp` |
| `GET /.well-known/oauth-authorization-server` | AS metadata |
| `POST /oauth/register` | dynamic client registration |
| `GET /oauth/authorize` | requires a logged-in session; consent screen naming tenant + scopes; **PKCE S256 mandatory** |
| `POST /oauth/token` | authorization-code exchange and refresh |

- Scopes: `books:read`, `books:write`. A token's effective permission is the
  **intersection** of its scopes and the granting user's role — an accountant cannot
  mint a token that does more than an accountant.
- Codes are single-use, short-lived, and consumed atomically (`consumed_at` set under
  the same update that reads them) so replay fails.
- Tokens are opaque and stored hashed.
- `redirect_uri` must match a registered URI exactly.

---

## 9. Receipts → Vercel Blob

`src/lib/receipts.ts` currently does `writeFileSync` / `readFileSync` under
`CASHISH_DATA_DIR`. Vercel has no writable filesystem, so this moves to
`@vercel/blob` with `access: "private"`, keyed `tenants/<tenantId>/receipts/<id><ext>`.
`receipts.storage_path` holds the blob pathname.

There are **0 receipts** to migrate, so nothing is at risk — but the code is
implemented properly rather than stubbed, because a stub means the feature 500s the
first time it is used.

---

## 10. Migration

`scripts/cloud-import.ts`:

```
npm run cloud:import -- --from ~/cashish-backups/20260825-121129/cashish.db \
                        --tenant <slug> --verify
```

- Reads the SQLite snapshot with `better-sqlite3` (demoted to a devDependency, used
  only here).
- **Refuses to run if the target tenant already has rows**, unless `--force`.
- Inserts per table in foreign-key-safe order:
  `tenants → settings → vat_rates → categories → customers → products → transactions
   → invoices → invoice_lines → payments → category_rules → recurring_* → employees
   → rpns → pay_runs → payslips → receipts`
- Coerces `0/1 → boolean` for the 14 boolean columns. Floats pass through unchanged.
- Stamps every row with `tenant_id`.
- **Verification, source vs target, exits non-zero on any mismatch:** per-table row
  counts plus `sum(transactions.amount)`, `sum(invoices.total)`,
  `sum(invoices.vat_total)`, `sum(invoices.amount_paid)`, `sum(payments.amount)`,
  compared against §1. Prints a reconciliation table.
- Idempotent only in the sense that it refuses to double-import; it is not a sync tool.

Cutover: import → verify → spot-check the UI against the local container side by side
→ stop `obh-cashish-1` → keep the backup directory.

---

## 11. Testing

Local Postgres in Docker (the user already runs `postgres:16`/`17` containers), a
throwaway database per run. Same dialect as production.

- The 3 existing tests (`rules`, `reconcile`, `exclude`) must pass against Postgres.
- `tests/tenancy.test.ts` — two tenants, overlapping data; every list/report/summary
  function returns only its own rows.
- `tests/rbac.test.ts` — the capability map: every role × every capability.
- `tests/apikeys.test.ts` — creation, prefix lookup, revocation, `last_used_at`.
- `tests/oauth.test.ts` — PKCE happy path; code replay rejected; wrong
  `code_verifier` rejected; scope ∩ role enforced.
- `tests/invoice-number.test.ts` — concurrent `createInvoice` calls produce distinct
  numbers (the race fixed in §5).
- `tests/import.test.ts` — round-trips a fixture SQLite database and asserts the sums.
- Playwright e2e — login, tenant switch, viewer cannot write, an MCP call with a key.

---

## 12. Deployment

- Vercel project, Node runtime (required for `AsyncLocalStorage` and `pg`).
- Neon provisioned through the Vercel Marketplace integration so `DATABASE_URL` is
  managed by the platform.
- Env: `DATABASE_URL`, `AUTH_SECRET`, `BLOB_READ_WRITE_TOKEN`, `APP_URL`.
- Build command runs `db:migrate` before `next build`.
- `scripts/bootstrap-owner.ts` — one-off, creates the first tenant and owner user.

### Removed from the repo

`electron/`, `Dockerfile`, `.dockerignore`, `src/db/migrate.ts`, `src/db/seed.ts`
(replaced by per-tenant seeding), `scripts/init-db.ts`, the `electron*` / `app:*`
npm scripts, the `build` (electron-builder) block in `package.json`, and the
Electron/`better-sqlite3` runtime dependencies.

---

## 13. Delivery — five PRs

| # | scope | why this boundary |
|---|---|---|
| ① | Postgres port + tenancy schema + async conversion + tests green on Postgres | the bulk; nothing else can be built on SQLite |
| ② | auth: users, memberships, invites, sessions, RBAC capability map, middleware | first point at which the app can be public |
| ③ | API keys + MCP over Streamable HTTP + `mcp/` restructure | public MCP, bearer-key auth |
| ④ | OAuth 2.1 authorization server | claude.ai Connector support |
| ⑤ | receipts → Blob, `cloud-import.ts`, deploy, bootstrap | cutover |

**Blast radius: essentially every file under `src/`.** After this the desktop app and
the container image are no longer the product; the Vercel deployment is.

---

## 14. Decision gates

Open questions that block the PR they name. To be resolved before that PR builds,
never guessed.

| id | question | blocks | default if unanswered |
|---|---|---|---|
| **D1** | Vercel project name and production domain? Needed for `APP_URL` and OAuth `redirect_uri` validation. | ⑤ (④ for redirect URIs) | Vercel-assigned `*.vercel.app` |
| **D2** | PR target branch. Repo has no staging; current branch is `feat/mcp-and-lunar-integration`. | ① | `main` |
| **D3** | Neon via the Vercel Marketplace integration, or an existing Neon project? | ① | Marketplace integration |
| **D4** | First tenant slug + name, and owner email. | ⑤ | slug from business name; owner `ethan@triplebolt.io` |
| **D5** | Does anyone besides the owner need access at cutover? Determines whether the invite flow ships in ② or is built-but-unused. | ② | built, unused, no email delivery |
| **D6** | Set `invoice_prefix = ''` and `next_invoice_seq = 1016` post-import so the next invoice is `1016`? (§1) | ⑤ | ask at cutover; change nothing silently |

## 15. Follow-ups deliberately excluded

- **`double precision` → `numeric(14,2)`** for money (§2) — its own change, its own
  reconciliation.
- Postgres RLS as defence in depth behind the query-layer scoping (§4) — the user
  chose query-layer only; this is the upgrade path if that ever feels thin.
- Invite email delivery (§6).
- Offline access. Retiring Electron removes it. If it is wanted back it should be
  designed deliberately, not recovered by keeping two SQL dialects alive.
