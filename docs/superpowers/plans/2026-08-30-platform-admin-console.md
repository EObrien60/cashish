# Platform Admin Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second application at `apps/admin` that manages tenants, users and subscriptions across the whole deployment, with an identity that is separate from every customer's and an audit trail on every change.

**Architecture:** A Next.js app beside `apps/books`, sharing `@cashish/core` and nothing else. It authenticates against a `platform_admins` table with its own signing secret and cookie, queries `db` directly rather than through the tenant-scoped domain layer, and records every mutation in `admin_audit_log`. Subscriptions are modelled per tenant with no payment processor; the books app enforces the resulting limits behind the existing `BILLING_LIVE` flag.

**Tech Stack:** Next.js 15 (App Router, React 19), TypeScript, drizzle-orm over `node-postgres`, `jose` for the session JWT, `node:crypto` scrypt for passwords, Tailwind, `node:test` via tsx.

**Spec:** `docs/superpowers/specs/2026-08-30-platform-admin-design.md` (§4–§7, PRs 3–7 of §8)

## Global Constraints

- **The books app's behaviour must not change while `BILLING_LIVE === false`.** Every limit added in Task 7 evaluates to "allowed" under that flag, and a test asserts it.
- **All existing suites keep passing:** 90 tests across 13 files in `apps/books/tests`. `tenancy`, `rbac` and `oauth` are guardrails — a failure there means this work widened something.
- **Test command:** `DATABASE_URL=postgres://cashish:cashish@127.0.0.1:5470/cashish_test npm test` from the repository root (books) and `npm test -w @cashish/admin` (admin).
- **`apps/admin` may never import from `apps/books`.** Task 4 adds a test that fails if it does.
- **`apps/admin/src/middleware.ts` must live under `src/`** and must not import anything reaching `node:crypto` — the same two traps `apps/books` already documents.
- **Admin queries run outside `runInTenant` on purpose** and use `db` from `@cashish/core/db` directly. Never make `ctx()` return a default to accommodate them.
- **Money is integer cents** in the new tables (`price_cents`), unlike the ledger's `double precision`. Dates and timestamps are ISO-8601 strings in `text`, matching the house convention.
- **Migrations only.** Edit `packages/core/src/db/schema.ts`, run `npm run db:generate`, commit the generated SQL. Never hand-edit `packages/core/drizzle/*.sql`.
- **No self-serve registration in the admin app, ever.** Administrators come from the CLI.

---

### Task 1: Schema — platform identity, audit, plans, subscriptions

**Files:**
- Modify: `packages/core/src/db/schema.ts`
- Create: `packages/core/drizzle/0006_*.sql` (generated)
- Create: `packages/core/src/plans.ts`

**Interfaces:**
- Produces, from `@cashish/core/db`: tables `platformAdmins`, `adminAuditLog`, `plans`, `subscriptions`; column `users.disabledAt`; types `PlatformAdmin`, `AdminAuditEntry`, `Plan`, `Subscription`.
- Produces, from `@cashish/core/plans`: `PLAN_CODES`, `type PlanCode`, `SUBSCRIPTION_STATUSES`, `type SubscriptionStatus`, `type PlanFeatures = { payroll: boolean; receipts: boolean; mcp: boolean; oauth: boolean }`, `SEED_PLANS: SeedPlan[]`, `DEFAULT_FEATURES`.

- [ ] **Step 1: Add the tables to the schema**

Four new tables and one new column, following the file's existing conventions (text ids, ISO strings, `now` default).

- `platformAdmins` — id, email (unique index), passwordHash, name, disabledAt, lastLoginAt, createdAt. No FK to `users`.
- `adminAuditLog` — id, adminId (FK platformAdmins), action, subjectType, subjectId, tenantId (nullable, no cascade — the row must outlive the tenant), before, after, createdAt. Index on (adminId, createdAt) and on (subjectType, subjectId).
- `plans` — code (pk), name, priceCents (nullable = "talk to us"), cadence, maxUsers (nullable = unlimited), features (text, JSON), isActive, sortOrder.
- `subscriptions` — id, tenantId (unique index, FK cascade), planCode, status, trialEndsAt, currentPeriodEnd, cancelledAt, note, createdAt, updatedAt.
- `users` — add `disabledAt: text("disabled_at")`.

`adminAuditLog.tenantId` must NOT cascade-delete: the record of deleting a tenant is the one that has to survive the tenant.

- [ ] **Step 2: Write `packages/core/src/plans.ts`**

Types and seed constants only — the values live in the database (spec D3). Export `PLAN_CODES`, `SUBSCRIPTION_STATUSES`, `PlanFeatures`, and `SEED_PLANS` carrying the three plans from spec §6.4 (sole €9 / 1 user; company €29 / unlimited + payroll, receipts, mcp; practice null / unlimited + oauth).

- [ ] **Step 3: Generate and inspect the migration**

```bash
cd ~/dev/misc/cashish-admin
DATABASE_URL=postgres://cashish:cashish@127.0.0.1:5470/cashish_dev npm run db:generate
```

Read the generated SQL. It must contain four `CREATE TABLE`s and one `ALTER TABLE users ADD COLUMN`, and no `DROP`.

- [ ] **Step 4: Hand-append the seed and backfill to the generated migration**

Drizzle generates DDL only. Append, in the same file so it is one atomic step:

1. `INSERT INTO plans` — the three rows from `SEED_PLANS`.
2. `INSERT INTO subscriptions` — one per existing tenant, plan `company`, status `active`, note `'granted by the 0006 backfill'`, selecting from `tenants`. Use `gen_random_uuid()::text` for ids.

Backfilling matters: without it the console opens on a list of tenants in an unknown state, and §6.5 requires no existing user loses anything.

- [ ] **Step 5: Apply and verify against a fresh database**

```bash
docker exec cashish-dev-pg psql -U cashish -d cashish_dev -c 'drop database if exists cashish_test;' -c 'create database cashish_test;'
DATABASE_URL=postgres://cashish:cashish@127.0.0.1:5470/cashish_test npm run db:migrate
docker exec cashish-dev-pg psql -U cashish -d cashish_test -c '\dt public.*' -c 'select code, price_cents, max_users from plans order by sort_order;'
```

Expected: 32 public tables (28 + 4), 7 migrations recorded, three plan rows.

- [ ] **Step 6: Confirm the books suite is unaffected, then commit**

```bash
DATABASE_URL=postgres://cashish:cashish@127.0.0.1:5470/cashish_test npm test
```

Expected: 90 passed, 0 failed. Adding tables nothing reads must change nothing.

---

### Task 2: The admin app skeleton and its session

**Files:**
- Create: `apps/admin/package.json`, `tsconfig.json`, `next.config.mjs`, `postcss.config.mjs`, `tailwind.config.ts`, `vercel.json`, `next-env.d.ts`
- Create: `apps/admin/src/lib/admin-session-cookie.ts` — the cookie name, and nothing else
- Create: `apps/admin/src/lib/admin-auth.ts` — password hashing/verification, `findAdminByEmail`, `recordLogin`
- Create: `apps/admin/src/lib/admin-session.ts` — sign/verify/set/clear, `currentAdmin()`
- Create: `apps/admin/src/middleware.ts`
- Create: `apps/admin/src/app/layout.tsx`, `page.tsx`, `login/page.tsx`, `auth-actions.ts`, `globals.css`
- Create: `apps/admin/scripts/create-admin.ts`
- Modify: root `package.json` (scripts delegating to `@cashish/admin`)

**Interfaces:**
- Consumes: `@cashish/core/db`, `@cashish/core/rbac`.
- Produces: `currentAdmin(): Promise<{ id: string; email: string; name: string } | null>`, `requireAdmin(): Promise<AdminIdentity>` (redirects to `/login` when absent), `ADMIN_SESSION_COOKIE`, `signAdminSession(claims: { aid: string }): Promise<string>`, `verifyAdminSession(token: string): Promise<{ aid: string } | null>`.

- [ ] **Step 1: Scaffold the workspace**

`@cashish/admin`, depending on `@cashish/core`, `next`, `react`, `react-dom`, `jose`. `next.config.mjs` needs `serverExternalPackages: ["pg"]` and `transpilePackages: ["@cashish/core"]`, exactly as books does. `tsconfig.json` mirrors books', including the `@cashish/core/*` path alias.

- [ ] **Step 2: Password hashing, reusing the books format**

scrypt, stored `"<saltHex>:<derivedKeyHex>"` — the same format `users.password_hash` uses, verified with `timingSafeEqual`. Same format, different table: an admin password and a customer password are never interchangeable because they are never looked up in the same place.

- [ ] **Step 3: The session, with its own secret**

`ADMIN_AUTH_SECRET`, minimum 32 chars, and it must **refuse to start if it equals `AUTH_SECRET`** — a shared secret would defeat the entire separation, and a config mistake that silently re-couples the two identities is exactly the kind that goes unnoticed. Claims are `{ aid }` only; 8-hour expiry. `currentAdmin()` re-reads the row every request and returns null when `disabledAt` is set, mirroring how books re-checks membership rather than trusting the token.

- [ ] **Step 4: The middleware**

Presence-only cookie check, as books does. Public prefixes: `/login`, `/_next/`, `/favicon`. Everything else redirects to `/login?next=…`. Import the cookie name from `admin-session-cookie.ts`, never from `admin-session.ts`, which reaches `node:crypto` via `jose`.

- [ ] **Step 5: The CLI**

```sh
npm run admin:create -- --email you@example.com --password '…' --name 'Ethan'
```

Rejects a password under 12 characters and a duplicate email. Prints the id. This is the only way an administrator comes into existence.

- [ ] **Step 6: Test the auth boundary**

`apps/admin/tests/admin-auth.test.ts`:
- a token signed with `AUTH_SECRET` fails `verifyAdminSession`
- a books session cookie value is not a valid admin session
- `currentAdmin()` returns null once `disabledAt` is set
- the wrong password fails; the right one succeeds
- construction throws when `ADMIN_AUTH_SECRET === AUTH_SECRET`

- [ ] **Step 7: Boot it and sign in, then commit**

Create an admin with the CLI, start the app on a free port (**not 3000 — the `qh-api-1` container owns it**), sign in through the browser, screenshot the landing page.

---

### Task 3: The audit log

**Files:**
- Create: `apps/admin/src/lib/audit.ts`
- Create: `apps/admin/tests/admin-audit.test.ts`

**Interfaces:**
- Produces: `recordAction(trx: Db, input: { adminId: string; action: string; subjectType: "tenant" | "user" | "subscription" | "plan"; subjectId: string; tenantId?: string | null; before?: unknown; after?: unknown }): Promise<void>`, and `withAudit<T>(adminId, entry, fn: (trx: Db) => Promise<T>): Promise<T>` which runs `fn` and the audit insert in ONE transaction.

- [ ] **Step 1: Write the failing test**

Assert that a mutation and its audit row commit together, and that when `fn` throws, neither the mutation nor the audit row is present. A log written on a best-effort basis is missing exactly the row you need.

- [ ] **Step 2: Implement `withAudit`** using `db.transaction`, passing the transaction handle into `fn` so callers cannot accidentally write outside it.

- [ ] **Step 3: Run the tests, then commit.**

---

### Task 4: Cross-tenant queries and the import boundary

**Files:**
- Create: `apps/admin/src/queries/tenants.ts`, `users.ts`, `subscriptions.ts`
- Create: `apps/admin/tests/boundaries.test.ts`
- Create: `apps/admin/tests/admin-queries.test.ts`

**Interfaces:**
- Produces: `listTenants(search?: string): Promise<TenantRow[]>` where `TenantRow = { id, slug, name, createdAt, memberCount, transactionCount, invoiceCount, lastActivity: string | null, planCode: string | null, status: string | null }`; `getTenant(id)`; `listUsers(search?)`; `getUser(id)`; `getSubscription(tenantId)`; `listPlans()`.

- [ ] **Step 1: Write `boundaries.test.ts` first**

Walk every `.ts`/`.tsx` under `apps/admin/src` and assert none imports `apps/books`, `@cashish/books`, or a relative path escaping into it. This is the only test here that fails for a design reason rather than a logic one, and the import it forbids is the one a future change will most want to add.

- [ ] **Step 2: Write `admin-queries.test.ts`**

Create three tenants with differing content; assert counts are per tenant and that the list returns all of them — the opposite of what `tenancy.test.ts` asserts for the books app, and deliberately so.

- [ ] **Step 3: Implement the query modules** using `db` directly, aggregate counts in SQL rather than per row.

- [ ] **Step 4: Run tests, then commit.**

---

### Task 5: Tenants and users screens

**Files:**
- Create: `apps/admin/src/app/tenants/page.tsx`, `tenants/[id]/page.tsx`, `users/page.tsx`, `users/[id]/page.tsx`, `audit/page.tsx`
- Create: `apps/admin/src/app/actions.ts`
- Create: `apps/admin/src/components/*` (nav, table, badge, confirm-delete)
- Modify: `apps/books/src/lib/session.ts` — reject a session whose user is disabled

**Interfaces:**
- Produces server actions: `setMemberRole`, `removeMember`, `revokeApiKey`, `revokeOauthToken`, `suspendTenant`, `deleteTenant`, `disableUser`, `enableUser`, `issuePasswordReset`. Every one goes through `withAudit`.

- [ ] **Step 1: `apps/books` — a disabled user has no session**

Add the `disabledAt` check to `currentSession()` beside the membership check, and a test in `apps/books/tests` asserting an existing session stops working once the column is set. This is the only change this plan makes to the books auth path, and §5.2 explains why it is deliberate.

- [ ] **Step 2: Build the screens**, each read going through Task 4's query modules and each write through Task 3's `withAudit`.

- [ ] **Step 3: `deleteTenant` writes its audit row with the tenant's row counts in `before`** — after the delete nothing else records that it existed. Requires typing the slug to confirm.

- [ ] **Step 4: Drive both screens in a browser**, exercise a role change and a key revocation, confirm the audit page shows them, screenshot.

- [ ] **Step 5: Run both suites, then commit.**

---

### Task 6: Subscriptions and plans screens

**Files:**
- Create: `apps/admin/src/app/subscriptions/page.tsx`, `plans/page.tsx`
- Modify: `apps/admin/src/app/tenants/[id]/page.tsx` (embed the subscription editor)
- Modify: `apps/admin/src/app/actions.ts`
- Create: `apps/admin/tests/subscriptions.test.ts`

- [ ] **Step 1: Write the tests first** — status transitions; the backfill leaves no tenant without a subscription; `suspendTenant` sets status `suspended`; creating a subscription for a tenant that has none.
- [ ] **Step 2: Build the editor** — plan, status, trial end, period end, note. Every save audited with before and after.
- [ ] **Step 3: Build the plans screen** — edit name, price, `maxUsers`, the four feature flags, active.
- [ ] **Step 4: Run tests, drive it in a browser, commit.**

---

### Task 7: Limits in the books app, and the pricing copy

**Files:**
- Create: `apps/books/src/lib/limits.ts`
- Modify: `apps/books/src/app/auth-actions.ts` (invite, accept-invite)
- Modify: `apps/books/src/lib/marketing.ts`
- Modify: `apps/books/src/app/pricing/page.tsx`, `src/components/marketing/PlanCards.tsx`
- Create: `apps/books/tests/plan-limits.test.ts`

**Interfaces:**
- Produces: `limitsFor(tenantId: string): Promise<{ maxUsers: number | null; features: PlanFeatures }>`, `assertWithinUserLimit(tenantId)`, `assertFeature(tenantId, feature: keyof PlanFeatures)`. All are no-ops returning "allowed" while `BILLING_LIVE === false`.

- [ ] **Step 1: Write `plan-limits.test.ts` first**, and make its **first** assertion that with `BILLING_LIVE === false` every gate allows everything. That is the assertion protecting existing users, so it should be the one that fails loudest.
- [ ] **Step 2: Implement `limits.ts`** reading the tenant's subscription and its plan.
- [ ] **Step 3: Apply the gates** at `inviteMember`, `acceptInvite`, payroll, receipts, API key creation and `/oauth/authorize`. `createBusiness` is deliberately NOT gated — under per-tenant billing a new business is a new subscription, not a quota.
- [ ] **Step 4: Rewrite the pricing copy** — prices per business per month; `PLANS` keeps the prose keyed by plan code while price, cadence and limits come from the `plans` table, so the page cannot advertise a limit the enforcement does not apply.
- [ ] **Step 5: Run the full suite, screenshot the pricing page, commit.**

---

### Task 8: Deploy the console

**Files:**
- Modify: `CLAUDE.md` (the admin app in the directory map, its env vars)
- Modify: `apps/admin/vercel.json`

- [ ] **Step 1: Create the Vercel project** `cashish-admin`, root directory `apps/admin`, framework `nextjs`, region `fra1`.

**Do not use `vercel deploy --yes` from an unlinked directory** — it creates a new project named after the directory and deploys there as production. That happened on 2026-08-30. Link explicitly first.

- [ ] **Step 2: Set env** — `DATABASE_URL` (the same Neon database), `ADMIN_AUTH_SECRET` (`openssl rand -base64 48`, **distinct from `AUTH_SECRET`**), `APP_URL`.
- [ ] **Step 3: Keep Vercel team SSO on for production**, not just previews. The console has its own password; there is still no reason its login page should be reachable by the public.
- [ ] **Step 4: `vercel build` locally to validate, then deploy a preview, then production.**
- [ ] **Step 5: Sign in against the deployed console, screenshot, commit the docs.**

---

## Self-Review

**Spec coverage.** §4.1 platform_admins → Task 2; §4.2 separate session → Task 2 Step 3; §4.3 cross-tenant queries and the boundary → Task 4; §4.4 audit log → Task 3; §5.1 tenants → Task 5; §5.2 users incl. `disabled_at` → Task 5 Step 1; §5.3/§6 subscriptions → Tasks 1 and 6; §6.4 enforcement and copy → Task 7; §7 testing → distributed, each suite in the task that makes it meaningful; §8 PR 7 deployment → Task 8. §5.4's exclusions are honoured by there being no task that reads a ledger.

**Placeholders.** None. Where a step says "build the screens" the interfaces block above it names every server action, and the behaviour that matters (audited, transactional, per-tenant) is specified.

**Type consistency.** `PlanFeatures` is defined in Task 1 and consumed in Task 7's `assertFeature(tenantId, feature: keyof PlanFeatures)`. `Db` in Task 3's `withAudit` is the type `@cashish/core/db` exports. `recordAction`'s `subjectType` union matches the four values the schema comment lists in Task 1.

**Ordering risk.** Task 7 changes the books app, which Task 5 Step 1 also touches (`session.ts`). They edit different functions in different files, but Task 5 must land first so `disabledAt` exists before limits are layered on.
