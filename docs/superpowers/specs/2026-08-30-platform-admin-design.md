# A platform admin console — tenants, users and subscriptions

**Status:** approved design, not yet implemented
**Date:** 2026-08-30
**Source of truth:** this document, until superseded
**Builds on:** `2026-08-25-cashish-cloud-design.md` (merged as PR #1, `9809b7a`)

cashish is now a multi-tenant service, and nobody can see it. There is no way to
answer "how many businesses are on this thing", "who is that person", "what is
this tenant paying" or "revoke that key" without opening a psql session against
production. This design adds a second application — a platform admin console —
that answers those questions, and adds the subscription model it needs in order
to have anything to say about billing.

Two structural moves make it possible: the repository becomes an npm workspace
with two apps over one shared core, and platform administrators become an
identity that is deliberately separate from the identity every customer uses.

---

## 1. Verified current state

Measured against `main` at `9809b7a`, not assumed.

### There is no monorepo

One `package.json` at the repository root, one Next.js app in `src/`. `mcp/`,
`scripts/` and `drizzle/` sit beside it. Adding "a second app" therefore means
creating the workspace, not slotting into one.

### There is no billing of any kind

| fact | evidence |
|---|---|
| No plan, subscription, price or trial column anywhere | `src/db/schema.ts` — 28 tables, none billing-related |
| No payment integration | no Stripe/Paddle dependency in `package.json` |
| Prices are marketing placeholders | `src/lib/marketing.ts:1-12`, `BILLING_LIVE = false` |
| The pricing page says so out loud | `src/components/marketing/PlanCards.tsx:101` `BillingNotice` |

### Any signed-in user can create unlimited businesses, free

`createBusiness` in `src/app/auth-actions.ts` gates on being signed in and
nothing else — deliberately, since there was no plan to check against:

> Any signed-in user may do this. There is no tenant context to check against —
> this is what *creates* one — so the only gate is being signed in.

That comment is correct today and stops being correct the moment plans exist.

### There is no platform-level identity

`users` + `memberships` resolve a person into one tenant with one role. Every
capability in `src/lib/rbac.ts` is scoped inside a tenant; the widest of them,
`tenant:delete`, deletes *your own* tenant. Nothing in the schema describes a
person who operates the service rather than uses it.

### Deployment is not wired to git

The Vercel project `prj_uCHVLOKJWI8tPeGZ47z5CFvqACUR` has `link: null` — no
GitHub connection. Every production deploy to date was a manual `vercel --prod`.
Merging to `main` does **not** migrate or ship, contrary to the comment at the
top of `.github/workflows/ci.yml`. Recorded here because the delivery plan below
assumes deploys are manual until someone connects it.

---

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **A subscription belongs to a tenant**, not to a person | Resolved by the user, 2026-08-30. Uniform with a schema in which everything else is tenant-scoped. The pricing copy is rewritten to match (§6.4). |
| D2 | **Platform admins are a separate table**, not a flag on `users` | §4. A shared identity plus a shared signing secret means a stolen customer cookie is an admin cookie. |
| D3 | **Plan definitions live in the database**, not in code | The console's job is to manage them; a table makes a price or a limit change an admin action rather than a deploy. |
| D4 | **The console cannot read customer books**, and cannot impersonate | §5.4. A privacy line worth crossing on purpose later, with consent and an audit trail, rather than having it open by default. |
| D5 | **No payment processor** | Nothing charges a card, so a processor would model an event that never happens. The schema below is the shape Stripe would fill in later. |
| D6 | **One shared package, not one per concern** | §3. `@cashish/core` with three entry points beats five packages whose only real content is a re-export. |

---

## 3. Repository structure

```
package.json                  private, workspaces: ["apps/*", "packages/*"]
packages/core/                @cashish/core
  src/db/schema.ts            every table, both apps
  src/db/client.ts            the lazy pool
  src/db/context.ts           tenant AsyncLocalStorage
  src/rbac.ts                 tenant roles and capabilities
  src/plans.ts                plan types, seed constants, limit lookups
  drizzle/                    migrations — one journal for the deployment
  scripts/migrate.ts
apps/books/                   today's application, moved wholesale
  src/ mcp/ scripts/ vercel.json next.config.mjs tailwind.config.ts
apps/admin/                   new
  src/ vercel.json next.config.mjs tailwind.config.ts
```

### Why one schema and one journal

Two apps writing the same Postgres database must agree about its shape. A schema
copied into each app is a schema that drifts on the first migration somebody
forgets to mirror, and the failure surfaces as a runtime column error in
production rather than at build time. `@cashish/core` exists so that
disagreement is not expressible.

`drizzle/` moves with the schema for the same reason: one migration journal for
one database. `drizzle.config.ts` moves to `packages/core` and points at
`src/db/schema.ts` there.

### Entry points

`@cashish/core/db`, `@cashish/core/rbac`, `@cashish/core/plans`, via the
`exports` map. TypeScript path aliases in both apps' `tsconfig.json` resolve
them, so no build step is required for the package — Next transpiles the
workspace source directly (`transpilePackages: ["@cashish/core"]`).

### What does not move into core

The domain — `src/lib/transactions.ts`, `invoices.ts`, `vat.ts` and the rest —
stays in `apps/books`. It is tenant-scoped by construction and the admin console
must not call it (§4.3). Moving it into a shared package would make the wrong
thing convenient.

`electron/` and `Dockerfile` are artefacts of the pre-cloud application and are
already dead. They move to `apps/books` unchanged rather than being deleted;
removing them is out of scope for this work.

### Phase 1 is a pure move

The first delivery changes no behaviour: files relocate, imports rewrite,
`npm test` passes with the same 13 suites and the same assertions. Anything that
fails at that point is a mistake in the move and not a design problem, which is
exactly why it ships on its own.

---

## 4. Platform identity

### 4.1 A separate table

```
platform_admins
  id             text primary key
  email          text not null      -- unique index
  password_hash  text not null      -- scrypt, same format as users
  name           text not null default ''
  disabled_at    text
  last_login_at  text
  created_at     text not null
```

No foreign key to `users`, and no `is_platform_admin` boolean on `users`. The
two identities are unrelated rows in unrelated tables, and being one grants
nothing about being the other.

The admin console has **no registration route**. Administrators are created from
the CLI:

```sh
npm run admin:create -- --email you@example.com --password '…'
```

A console that can suspend a business and rewrite its plan should not have a
self-serve path into it, and there is no growth argument for one.

### 4.2 A separate session

| | books | admin |
|---|---|---|
| cookie | `cashish_session` | `cashish_admin_session` |
| secret | `AUTH_SECRET` | `ADMIN_AUTH_SECRET` |
| claims | `{ uid, tid }` | `{ aid }` |
| lifetime | 14 days | 8 hours |

Distinct secrets are the point of the exercise. A total compromise of the books
signing key lets an attacker mint any customer session they like and grants them
nothing here, because the admin verifier will not accept a signature made with
it. The shorter lifetime follows from the blast radius: a stale customer session
is one business, a stale admin session is all of them.

`apps/admin/src/middleware.ts` gates every path except `/login` and `/_next/`.
As in books, it must live under `src/`, and must not import anything reaching
`node:crypto` — the same two traps, and they will bite the same way.

### 4.3 Cross-tenant queries, without weakening the tenant gate

`src/db/context.ts` throws when a query runs outside `runInTenant`, and that
behaviour is load-bearing for customer isolation. The admin console legitimately
queries across every tenant, so it must not go through the domain layer at all:
it uses `db` from `@cashish/core/db` directly, in its own
`apps/admin/src/queries/*` modules, and never calls `apps/books`.

This is enforced, not merely documented — a test asserts no file under
`apps/admin/src` imports from `apps/books` or from any tenant-scoped module
(§7). The boundary is the kind that erodes silently the first time somebody
wants one convenient function.

### 4.4 The audit log

```
admin_audit_log
  id            text primary key
  admin_id      text not null      -- references platform_admins
  action        text not null      -- 'subscription.update', 'api_key.revoke', …
  subject_type  text not null      -- 'tenant' | 'user' | 'subscription' | 'plan'
  subject_id    text not null
  tenant_id     text               -- nullable: not every action has one
  before        text               -- JSON, null on create
  after         text               -- JSON, null on delete
  created_at    text not null
```

Every mutating action in the console writes one row, in the same transaction as
the mutation, through a single `recordAction()` helper that the write path calls
— not a decorator anyone can forget to apply. A console that can change what a
customer pays and revoke their access is worth nothing without a record of who
did it, and an audit log written on a best-effort basis is an audit log that is
missing exactly the row you need.

The log is append-only: the console renders it and offers no delete.

---

## 5. What the console does

### 5.1 Tenants

**List.** Slug, name, created, plan, subscription status, member count,
transaction count, invoice count, last activity (most recent transaction or
invoice). Search by slug, name or member email. Sortable by created and by
status.

**Detail.** Everything on one page:

- identity — slug, name, created, id
- settings snapshot — business name, VAT number, VAT basis, invoice prefix
- members — email, name, role, joined; change role; remove
- machine access — API keys (name, prefix, role, last used) with revoke; OAuth
  tokens grouped by client with revoke
- subscription — the editor described in §6.3
- danger zone — suspend, and delete

**Suspend** sets the subscription status to `suspended` and is reversible.
Suspension blocks sign-in to that tenant and returns a plain message; it does
not touch the data.

**Delete** cascades — every domain table has `on delete cascade` to `tenants`.
It requires typing the slug to confirm, and writes an audit row containing the
tenant's identity and its row counts, because after the delete nothing else
records that it existed.

### 5.2 Users

**List.** Email, name, created, number of memberships, last login. Search by
email or name.

**Detail.** Memberships across every tenant with the role in each, the tenants
they own, and their API keys. Actions: force a password reset (issues a
single-use link, rather than the console choosing a password), and disable.

Disabling a user requires a new `users.disabled_at` column — `currentSession()`
gains a check on it, alongside the membership check it already does. This is the
one change this design makes to the books app's auth path, and it is deliberate:
a support console that cannot stop a compromised account is not much of one.

### 5.3 Subscriptions and plans

Covered in §6.

### 5.4 What it deliberately cannot do

**Read a customer's books.** No transaction, invoice, receipt or payslip is
reachable from the console — only counts and dates. This is an accounting
product; the aggregate answers support questions ("do they have data?", "when
did they last import?") without anyone reading a customer's ledger.

**Impersonate.** Signing in as a customer is the natural next request and is
excluded on purpose. When it is built it needs consent, a time limit, a banner
in the impersonated session and its own audit action — none of which is worth
half-doing now.

Both are listed in §9 as follow-ups rather than omissions.

---

## 6. Subscriptions

### 6.1 Schema

```
plans
  code            text primary key    -- 'sole' | 'company' | 'practice'
  name            text not null
  price_cents     integer             -- null means "talk to us"
  cadence         text not null default 'month'
  max_users       integer             -- null means unlimited
  features        text not null       -- JSON: {"payroll":true,"receipts":true,…}
  is_active       boolean not null default true
  sort_order      integer not null default 0

subscriptions
  id                  text primary key
  tenant_id           text not null    -- unique index, references tenants cascade
  plan_code           text not null    -- references plans.code
  status              text not null    -- see below
  trial_ends_at       text
  current_period_end  text
  cancelled_at        text
  note                text not null default ''
  created_at          text not null
  updated_at          text not null
```

Status is one of `trialing`, `active`, `past_due`, `cancelled`, `suspended`.
`past_due` exists now even though nothing can fail to charge, because it is the
state a processor will report later and adding it now costs nothing.

`note` is free text and it earns its place: real subscription decisions are
mostly exceptions ("extended their trial, migrating from Sage"), and a console
without somewhere to write down why is a console whose history is a mystery.

Dates are ISO-8601 strings in `text`, money is an integer of cents. Both follow
the house conventions — dates because the rest of the query layer compares them
lexicographically, and cents because these are prices rather than the ledger's
`double precision` amounts, and a price should never be a float.

### 6.2 Why plan definitions are a table (D3)

Putting the plans in `packages/core/plans.ts` would mean a deploy to change a
price or raise a limit, and the console's whole purpose is that these are
operational actions. The table is seeded by migration with the three plans, and
`plans.ts` holds the *types*, the seed constants and the lookup helpers rather
than the values themselves.

### 6.3 The editor

Per tenant: plan, status, trial end, current period end, and the note. Saving
writes the subscription and one audit row carrying before and after.

The console can also create a subscription for a tenant that has none, and can
edit plan definitions themselves — name, price, `max_users`, feature flags,
active — on a separate screen.

### 6.4 Enforcement, and the marketing copy (D1)

Because a subscription belongs to a tenant, a plan describes **one set of
books**. That contradicts today's copy, which sells "up to five businesses" on
one plan, so `src/lib/marketing.ts` is rewritten: prices are stated per business
per month, and what separates the plans is how many people may be in one set of
books and which features it includes.

| plan | price | max_users | features |
|---|---|---|---|
| Sole trader | €9 / business / month | 1 | books, rules, invoicing, VAT, one read-only API key |
| Company | €29 / business / month | unlimited | + payroll, receipts, MCP, invites |
| Practice | talk to us | unlimited | + OAuth clients, volume pricing across businesses |

`PLANS` in `marketing.ts` keeps the prose — the pitch and the bullet list, keyed
by plan code — while price, cadence and limits are read from the `plans` table,
so the page cannot advertise a limit the enforcement does not apply.

Enforcement lives in the books app and reads `@cashish/core/plans`:

| limit | enforced at |
|---|---|
| `max_users` | `inviteMember` and `acceptInvite` in `src/app/auth-actions.ts` |
| `features.payroll` | the payroll routes and pages |
| `features.receipts` | receipt upload |
| `features.mcp` | API key creation, and `/api/mcp` authentication |
| `features.oauth` | `/oauth/authorize` |

**Every one of these checks is behind `BILLING_LIVE`.** While the flag is false
they evaluate to "allowed", which means this work can land without changing the
experience of a single existing user, and flipping the flag is a separate,
deliberate decision taken when prices are real.

`createBusiness` is explicitly **not** limited. Under per-tenant billing a new
business is a new subscription rather than a quota to check, so the comment
quoted in §1 stays true.

### 6.5 Backfill

The migration that creates the tables also gives every existing tenant a
subscription: plan `company`, status `active`, `current_period_end` null, note
recording that it was granted by the backfill. Nobody who is using cashish today
loses anything, and the console opens with a complete picture rather than a list
of tenants in an unknown state.

---

## 7. Testing

The existing suites move to `apps/books/tests` and must pass unchanged after
phase 1 — `tenancy.test.ts`, `rbac.test.ts` and `oauth.test.ts` above all, since
they are the isolation guardrails and this work adds a second reader of the same
database.

New suites, in `apps/admin/tests`:

| suite | asserts |
|---|---|
| `admin-auth.test.ts` | a books session cookie is rejected by the admin verifier and vice versa; a cookie signed with `AUTH_SECRET` fails `ADMIN_AUTH_SECRET`; a disabled admin cannot sign in; sessions expire at 8h |
| `admin-audit.test.ts` | every mutating action writes exactly one row with before/after; a failed mutation writes none (same transaction) |
| `admin-queries.test.ts` | cross-tenant reads return every tenant; counts are right with several tenants present |
| `boundaries.test.ts` | no file under `apps/admin/src` imports `apps/books` or a tenant-scoped domain module |
| `subscriptions.test.ts` | status transitions; the backfill leaves no tenant without a subscription; suspend blocks sign-in |

And in `apps/books/tests`:

| suite | asserts |
|---|---|
| `plan-limits.test.ts` | `max_users` blocks the invite that exceeds it and allows the one that does not; every feature gate; **and that all of them allow everything while `BILLING_LIVE` is false** |
| `users.test.ts` (extended) | a disabled user's existing session stops working |

`boundaries.test.ts` deserves its place: it is the only one of these that fails
for a design reason rather than a logic reason, and the import it forbids is the
one a future change will most want to add.

---

## 8. Delivery

Seven pull requests, each independently reviewable and green.

| # | PR | Contents |
|---|---|---|
| 1 | Workspace split | Root workspace, `apps/books` move, no behaviour change, 13 suites green |
| 2 | Extract `@cashish/core` | schema, client, context, rbac, drizzle, migrate script; both apps' tsconfig paths |
| 3 | Admin skeleton | `apps/admin`, `platform_admins`, login, middleware, `admin:create`, audit log + helper |
| 4 | Tenants and users | list and detail screens, member/key/token actions, suspend, delete, `users.disabled_at` |
| 5 | Subscriptions | `plans` + `subscriptions` tables, seed, backfill, editors |
| 6 | Limits and copy | enforcement behind `BILLING_LIVE`, `marketing.ts` rewrite, pricing page reads the table |
| 7 | Deploy | Vercel project `cashish-admin`, root `apps/admin`, `fra1`, `ADMIN_AUTH_SECRET`; existing project's root directory set to `apps/books` |

PR 1 and PR 7 are the two that can break something that currently works — the
first because it moves every file, the last because it repoints a live project's
root directory. Both are small and both are reversible.

### Deployment notes

The admin console is a separate Vercel project on the same Neon database, in
`fra1` beside it. Vercel team SSO stays on for its **production** deployment as
well as its previews — the console has its own password, and there is no reason
for the login page of a platform admin tool to be reachable by the public at
all.

`CASHISH_ALLOW_PREVIEW_DB` applies to the admin app exactly as it does to books:
previews share the production database and both apps refuse to open a connection
under `VERCEL_ENV=preview` without it.

---

## 9. Follow-ups deliberately excluded

- **Stripe.** The schema above is the shape a processor fills in. Adding one is
  its own piece of work, and it needs real prices, Irish VAT on digital services
  and a customer portal decided first.
- **Impersonation** (§5.4), which needs consent, expiry, a visible banner and
  its own audit action.
- **Book access from the console** (§5.4).
- **TOTP on admin accounts.** Defensible to skip while there is one
  administrator; not defensible once there are several.
- **Restoring the Vercel git connection** (§1), so that merging to `main`
  actually deploys. Worth doing, unrelated to this design.
- **Usage metering.** Nothing counts imports or API calls per tenant, so no plan
  can be priced on volume. Out of scope until a plan wants it.
