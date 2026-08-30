# Workspace Split and `@cashish/core` Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-app repository into an npm workspace with `apps/books` and a shared `@cashish/core` package, so a second application (the platform admin console) can share one schema and one migration journal.

**Architecture:** Two steps, each independently green. First a pure move: every file relocates under `apps/books` with the `@/*` alias still pointing at its own `src/`, so not one import statement changes. Then an extraction: the database layer (schema, client, tenant context, migrations) and the RBAC policy move into `packages/core`, and the ~50 files that referenced them through `@/db/*` and `@/lib/rbac` are repointed at `@cashish/core/*`.

**Tech Stack:** npm workspaces, Next.js 15, TypeScript 5.7, drizzle-orm over `node-postgres`, `node:test` via tsx, Postgres 17 in a container.

**Spec:** `docs/superpowers/specs/2026-08-30-platform-admin-design.md` (§3, and PRs 1–2 of §8)

## Global Constraints

- **No behaviour changes.** This plan moves code. If a test assertion needs editing to pass, that is a mistake in the move — stop and fix the move.
- **All 13 existing suites (90 tests) must pass at the end of every task**, not just at the end of the plan: `analysis, exclude, health, invoice-number, oauth, people, posting, rbac, reconcile, register, rules, tenancy, vendors`.
- **Test command:** `DATABASE_URL=postgres://cashish:cashish@127.0.0.1:5470/cashish_test npm test -w @cashish/books` from the repository root. The harness refuses any `DATABASE_URL` not matching `/test/i`.
- **Postgres must be running:** `docker start cashish-dev-pg` (container on `:5470`, databases `cashish_dev` and `cashish_test`).
- **Use `git mv`, never `cp` + `rm`.** Rename detection is what makes this reviewable; a copy-and-delete produces a diff nobody can read.
- **`src/middleware.ts` must stay under the app's `src/`** — at an app root Next.js ignores it silently and the session gate stops running with no error.
- **Nothing in `packages/core` may import from `apps/*`.** The dependency runs one way.
- **Node 24** (`.nvmrc`), npm workspaces, one `package-lock.json` at the repository root.

---

### Task 1: Root workspace and the `apps/books` move

Pure relocation. The `@/*` path alias is redefined relative to the new location, so every `@/...` import in the codebase keeps resolving to the same file it does today and no source file's import list changes.

**Files:**
- Create: `package.json` (new root workspace manifest)
- Create: `apps/books/package.json` (the current root manifest, renamed)
- Move: `src/` → `apps/books/src/`
- Move: `mcp/` → `apps/books/mcp/`
- Move: `scripts/` → `apps/books/scripts/`
- Move: `tests/` → `apps/books/tests/`
- Move: `drizzle/` → `apps/books/drizzle/`
- Move: `drizzle.config.ts`, `next.config.mjs`, `postcss.config.mjs`, `tailwind.config.ts`, `tsconfig.json`, `next-env.d.ts`, `vercel.json`, `Dockerfile`, `.dockerignore`, `electron/`, `build/` → `apps/books/`
- Unchanged at root: `README.md`, `CLAUDE.md`, `docs/`, `.github/`, `.gitignore`, `.nvmrc`, `.mcp.json`, `package-lock.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: nothing.
- Produces: the workspace `@cashish/books` rooted at `apps/books`. Root scripts `npm run dev|build|test|db:migrate` delegate to it. Every existing module path is `apps/books/<old path>`.

- [ ] **Step 1: Confirm the baseline is green before moving anything**

```bash
docker start cashish-dev-pg
cd ~/dev/misc/cashish-admin
DATABASE_URL=postgres://cashish:cashish@127.0.0.1:5470/cashish_test npm test 2>&1 | tail -20
```

Expected: `# tests 90`, `# pass 90`, `# fail 0` across 13 files. Verified green on this worktree at commit `e80a8a2` on 2026-08-30. **If this is not green, stop.** A move cannot be verified against a broken baseline. Record the pass/fail counts — the same numbers must appear at the end of Task 1.

- [ ] **Step 2: Move the application into `apps/books`**

```bash
cd ~/dev/misc/cashish-admin
mkdir -p apps/books
for item in src mcp scripts tests drizzle drizzle.config.ts next.config.mjs \
            postcss.config.mjs tailwind.config.ts tsconfig.json next-env.d.ts \
            vercel.json Dockerfile .dockerignore electron build package.json; do
  git mv "$item" "apps/books/$item"
done
```

Note: `for item in …`, not `for path in …`. In zsh `path` is tied to `PATH` and assigning to it destroys the shell's command lookup.

- [ ] **Step 3: Rename the moved manifest and drop the workspace-level scripts**

Edit `apps/books/package.json`: change `"name": "cashish"` to `"name": "@cashish/books"`. Leave every script and every dependency exactly as it is.

- [ ] **Step 4: Write the root workspace manifest**

Create `package.json`:

```json
{
  "name": "cashish",
  "version": "0.1.0",
  "private": true,
  "description": "Lightweight EUR accounting — statements, invoicing, VAT, payroll.",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "npm run dev -w @cashish/books",
    "build": "npm run build -w @cashish/books",
    "start": "npm run start -w @cashish/books",
    "lint": "npm run lint -w @cashish/books",
    "test": "npm run test -w @cashish/books",
    "db:generate": "npm run db:generate -w @cashish/books",
    "db:migrate": "npm run db:migrate -w @cashish/books",
    "bootstrap": "npm run bootstrap -w @cashish/books",
    "mcp": "npm run mcp -w @cashish/books"
  }
}
```

- [ ] **Step 5: Reinstall so npm links the workspace**

```bash
cd ~/dev/misc/cashish-admin
rm -rf node_modules
npm install
```

Expected: npm reports the workspace and creates a symlink `node_modules/@cashish/books` → `apps/books`. `package-lock.json` gains a `"apps/books"` entry; commit the change.

- [ ] **Step 6: Run the suite from the workspace**

```bash
DATABASE_URL=postgres://cashish:cashish@127.0.0.1:5470/cashish_test npm test
```

Expected: `# pass 90`, `# fail 0` — identical to Step 1.

Why this works without touching a single import: `apps/books/tsconfig.json` still says `"paths": {"@/*": ["./src/*"]}`, and it now sits beside `apps/books/src`. The harness's `execFileSync("npx", ["tsx", "scripts/migrate.ts"])` is relative to the working directory, and `npm test -w @cashish/books` runs with the working directory set to `apps/books`, so it still resolves. `drizzle.config.ts` says `schema: "./src/db/schema.ts"` and `out: "./drizzle"`, both of which moved with it.

- [ ] **Step 7: Verify the app builds and boots**

```bash
DATABASE_URL=postgres://cashish:cashish@127.0.0.1:5470/cashish_dev npm run build
```

Expected: `next build` completes. This matters more than it looks — `next build` imports every route module, so a path that silently broke shows up here rather than in production.

- [ ] **Step 8: Point CI at the workspace**

In `.github/workflows/ci.yml`, the checkout and `npm ci` at the repository root are already correct for a workspace. Change the test invocation to run from the root (`npm test`, which delegates), and correct the stale comment at the top of the file:

```yaml
# Gates the merge. NOTE: the Vercel project has no GitHub connection, so
# merging does NOT deploy — production ships by `vercel --prod` by hand.
```

The existing comment claims landing on `main` migrates production and ships. It does not, and a comment that misdescribes the deploy path is worse than no comment.

- [ ] **Step 9: Verify CI's own command locally**

```bash
cd ~/dev/misc/cashish-admin
npm ci
DATABASE_URL=postgres://cashish:cashish@127.0.0.1:5470/cashish_test npm test
```

Expected: `# pass 90`, `# fail 0` from a clean install, which is what CI will do.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Move the application into apps/books, under an npm workspace

A second application needs to share this one's schema, and two apps need
a workspace to live in. This is the move and nothing else: the @/* alias
now resolves against apps/books/src, so not one import statement changes
and the thirteen suites pass with the same counts as before."
```

---

### Task 2: Create `packages/core` and move the database layer into it

The schema, the pool, the tenant context and the migrations move to the shared package. This is the task that changes imports.

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/db/index.ts`
- Move: `apps/books/src/db/schema.ts` → `packages/core/src/db/schema.ts`
- Move: `apps/books/src/db/client.ts` → `packages/core/src/db/client.ts`
- Move: `apps/books/src/db/context.ts` → `packages/core/src/db/context.ts`
- Move: `apps/books/src/lib/rbac.ts` → `packages/core/src/rbac.ts`
- Move: `apps/books/drizzle/` → `packages/core/drizzle/`
- Move: `apps/books/drizzle.config.ts` → `packages/core/drizzle.config.ts`
- Move: `apps/books/scripts/migrate.ts` → `packages/core/scripts/migrate.ts`
- Create: `packages/core/src/migrate.ts`
- Modify: `packages/core/scripts/migrate.ts` (becomes a thin CLI wrapper)
- Modify: `apps/books/next.config.mjs` (add `transpilePackages`)
- Modify: `apps/books/tsconfig.json` (add the `@cashish/core/*` path alias)
- Modify: `apps/books/package.json` (depend on `@cashish/core`)
- Modify: `apps/books/tests/harness.ts`
- Modify: ~50 source files, mechanically (Step 6)
- Stays in `apps/books`: `src/db/seed.ts` — it seeds VAT rates and categories, which is domain, not schema.

**Interfaces:**
- Consumes: the workspace from Task 1.
- Produces:
  - `@cashish/core/db` → `db`, `pool`, `schema`, `first<T>(rows: T[]): T | null`, `type Db`, and the tenant context: `runInTenant<T>(context: TenantContext, fn: () => Promise<T>): Promise<T>`, `ctx(): TenantContext`, `tenantId(): string`, `currentRole(): Role`, `maybeContext(): TenantContext | undefined`, `type TenantContext = { tenantId: string; role: Role; actor: string }`
  - `@cashish/core/rbac` → `ROLES`, `type Role`, `CAPABILITIES`, `type Capability`, `can(role, capability): boolean`, `requireCapability(role, capability): void`, `ForbiddenError`, `isRole(value): value is Role`, `SCOPES`, `type Scope`, `scopesForRole(role): Scope[]`
  - `@cashish/core/migrate` → `migrate(): Promise<void>`

- [ ] **Step 1: Create the package manifest**

Create `packages/core/package.json`:

```json
{
  "name": "@cashish/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    "./db": "./src/db/index.ts",
    "./rbac": "./src/rbac.ts",
    "./migrate": "./src/migrate.ts"
  },
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx scripts/migrate.ts"
  },
  "dependencies": {
    "drizzle-orm": "^0.38.4",
    "pg": "^8.23.0"
  },
  "devDependencies": {
    "@types/pg": "^8.23.1",
    "drizzle-kit": "^0.30.2",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3"
  }
}
```

The `exports` map points at TypeScript source, not a build output. Next transpiles it via `transpilePackages` and `tsx` reads it directly, so the package needs no build step and no `dist/` to keep in sync.

Create `packages/core/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["esnext"],
    "strict": true,
    "noEmit": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["src/**/*.ts", "scripts/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 2: Move the files**

```bash
cd ~/dev/misc/cashish-admin
mkdir -p packages/core/src/db packages/core/scripts
git mv apps/books/src/db/schema.ts  packages/core/src/db/schema.ts
git mv apps/books/src/db/client.ts  packages/core/src/db/client.ts
git mv apps/books/src/db/context.ts packages/core/src/db/context.ts
git mv apps/books/src/lib/rbac.ts   packages/core/src/rbac.ts
git mv apps/books/drizzle           packages/core/drizzle
git mv apps/books/drizzle.config.ts packages/core/drizzle.config.ts
git mv apps/books/scripts/migrate.ts packages/core/scripts/migrate.ts
```

- [ ] **Step 3: Fix the two internal imports the move broke**

`packages/core/src/db/context.ts` imports `Role` from `@/lib/rbac`, which no longer resolves inside the package. Change it to a relative import:

```typescript
import type { Role } from "../rbac";
```

`packages/core/src/db/client.ts` imports `./schema`, which is still correct — leave it.

- [ ] **Step 4: Write the package's `db` entry point**

Create `packages/core/src/db/index.ts`:

```typescript
/**
 * The database entry point both applications import.
 *
 * Re-exports rather than re-implements: `client.ts` remains the single point of
 * driver coupling and `context.ts` remains the single tenant gate. This file
 * exists so that consumers write `@cashish/core/db` instead of reaching into
 * the package's internal file layout, which would make that layout impossible
 * to change.
 */
export { db, pool, schema, first, type Db } from "./client";
export {
  runInTenant,
  ctx,
  tenantId,
  currentRole,
  maybeContext,
  type TenantContext,
} from "./context";
export * as tables from "./schema";
```

- [ ] **Step 5: Make the migration runner importable, and path-independent**

This is the one place the move changes behaviour if it is done carelessly. `scripts/migrate.ts` passes `migrationsFolder: "./drizzle"`, which resolves against the **working directory**. Once the migrations live in `packages/core` and are run from `apps/books` or from an app's build, `./drizzle` points somewhere that does not exist — and drizzle's migrator treats an empty folder as "nothing to do", so it reports success and applies nothing. Resolve it against the module instead.

Create `packages/core/src/migrate.ts` with the whole of the existing script's logic, changed only in those two respects:

```typescript
/**
 * Applies pending drizzle migrations.
 *
 * Wrapped in a Postgres advisory lock, because more than one migrator can
 * genuinely start at once: two deployments building concurrently, or the test
 * suite, where every test file runs in its own process and each ensures the
 * schema. Without the lock they race on the migrations table and most of them
 * fail. With it, the first wins and the rest wait and then find nothing to do.
 */
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate as runMigrations } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";

/** Any stable 64-bit key; this one is just "cashish migrations". */
const LOCK_KEY = 8_142_539_071_004_311n;

/**
 * Resolved against this module, never the working directory. The migrations
 * now live in a package that is run from two applications and from the test
 * harness, and drizzle treats a folder that does not exist as "no pending
 * migrations" — it would report success and apply nothing.
 */
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

export async function migrate(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");

  // This opens its own pool, so it does not inherit the preview guard in
  // client.ts. Without the same check here, a preview BUILD would migrate the
  // production database — the one thing a preview must never touch.
  if (process.env.VERCEL_ENV === "preview" && !process.env.CASHISH_ALLOW_PREVIEW_DB) {
    console.log(
      "preview deployment: skipping migrations, since DATABASE_URL points at the shared " +
        "(production) database. Set CASHISH_ALLOW_PREVIEW_DB=1 once preview has its own.",
    );
    return;
  }

  const pool = new Pool({
    connectionString,
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: true },
    // One connection: the lock is held on a session, so it must be the same one.
    max: 1,
  });
  const db = drizzle(pool);
  const target = connectionString.replace(/:[^:@/]+@/, ":***@");

  await db.execute(sql`select pg_advisory_lock(${LOCK_KEY})`);
  try {
    console.log(`migrating ${target}`);
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log("migrations applied");
  } finally {
    await db.execute(sql`select pg_advisory_unlock(${LOCK_KEY})`);
    await pool.end();
  }
}
```

Replace `packages/core/scripts/migrate.ts` entirely with the CLI wrapper:

```typescript
#!/usr/bin/env tsx
/**
 * CLI entry point. Run by the Vercel build before `next build`, and by hand in
 * dev. Nothing applies schema at request time.
 */
import { migrate } from "../src/migrate";

migrate().catch((error) => {
  console.error("migration failed:", error);
  process.exit(1);
});
```

- [ ] **Step 6: Point `drizzle.config.ts` at the schema in its new home**

`packages/core/drizzle.config.ts` moved alongside both the schema and the migrations, so its relative paths are already correct (`./src/db/schema.ts`, `./drizzle`). Read it and confirm — change nothing if so.

- [ ] **Step 7: Wire the books app to the package**

`apps/books/package.json` — add to `dependencies`:

```json
"@cashish/core": "*"
```

and change two scripts to delegate, since the migrations no longer live here:

```json
"db:generate": "npm run db:generate -w @cashish/core",
"db:migrate": "npm run db:migrate -w @cashish/core",
```

`apps/books/next.config.mjs`:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  // `pg` is a native-ish driver with dynamic requires; keep it out of the bundle.
  serverExternalPackages: ["pg"],
  // @cashish/core is published as TypeScript source, so Next must compile it.
  transpilePackages: ["@cashish/core"],
};

export default nextConfig;
```

`apps/books/tsconfig.json` — extend `paths` so the editor and `tsc` resolve the package's export map without a build:

```json
"paths": {
  "@/*": ["./src/*"],
  "@cashish/core/*": ["../../packages/core/src/*"]
}
```

Note the asymmetry this creates: `@cashish/core/db` resolves through the tsconfig path to `packages/core/src/db` (a directory, picked up as `index.ts`), and through the `exports` map at runtime to the same file. Both agree; the alias exists only so the language server does not need the package built.

- [ ] **Step 8: Rewrite the imports across the books app**

50 files reference these modules. Do it mechanically, then read the diff.

```bash
cd ~/dev/misc/cashish-admin/apps/books
FILES=$(grep -rl '@/db/client\|@/db/schema\|@/db/context\|@/lib/rbac' src mcp scripts tests)
for f in $FILES; do
  perl -pi -e 's{"\@/db/(client|schema|context)"}{"\@cashish/core/db"}g; s{"\@/lib/rbac"}{"\@cashish/core/rbac"}g' "$f"
done
```

Then fix what the blunt substitution leaves behind:

1. **Files that imported from two of the three db modules now have two imports from `@cashish/core/db`.** That is legal TypeScript and it compiles, but merge them — `import { db, schema, tenantId } from "@cashish/core/db";` reads better than three lines saying the same thing.
2. **`import * as schema from "@/db/schema"`** becomes `import { tables as schema } from "@cashish/core/db"` — the entry point exports the namespace under `tables`.
3. **Relative imports in `tests/`, `mcp/` and `scripts/`** (31 files use `../src/…`). Rewrite those that point at the moved files:

```bash
cd ~/dev/misc/cashish-admin/apps/books
perl -pi -e 's{"\.\./src/db/(client|schema|context)"}{"\@cashish/core/db"}g;
             s{"\.\./src/lib/rbac"}{"\@cashish/core/rbac"}g;
             s{"\.\./\.\./src/db/(client|schema|context)"}{"\@cashish/core/db"}g;
             s{"\.\./\.\./src/lib/rbac"}{"\@cashish/core/rbac"}g' \
  $(grep -rl '\.\./src/db/\|\.\./src/lib/rbac\|\.\./\.\./src/db/\|\.\./\.\./src/lib/rbac' tests mcp scripts)
```

- [ ] **Step 9: Update the test harness to import the migrator**

In `apps/books/tests/harness.ts`, replace the subprocess with a direct call. The subprocess existed to run a script by path; now that the migrator is a function in a package, shelling out only adds a process and a cwd assumption.

Replace the `execFileSync` import and the body of `ensureSchema`:

```typescript
import { runInTenant } from "@cashish/core/db";
import type { Role } from "@cashish/core/rbac";
import { migrate } from "@cashish/core/migrate";

const url = process.env.DATABASE_URL ?? "";
if (!/test/i.test(url)) {
  throw new Error(
    `refusing to run against ${url || "the default database"} — DATABASE_URL must name a test database`,
  );
}

let migrated = false;

/** Applies migrations once per process. */
export async function ensureSchema() {
  if (migrated) return;
  await migrate();
  migrated = true;
}
```

`ensureSchema` becomes async, so its one caller inside `makeTenant` must await it:

```typescript
export async function makeTenant(label: string) {
  await ensureSchema();
  const { createTenant } = await import("../src/db/seed");
  const { uid } = await import("../src/lib/id");
  const slug = `test-${label}-${uid().slice(0, 8)}`;
  const id = await createTenant({ slug, name: `Test ${label}` });
  return { id, slug };
}
```

Also update `closePool`, whose dynamic import moved:

```typescript
export async function closePool() {
  const { pool } = await import("@cashish/core/db");
  await pool.end();
}
```

Check whether any test file calls `ensureSchema()` directly without awaiting:

```bash
grep -rn "ensureSchema" apps/books/tests/
```

Every call site must now be awaited.

- [ ] **Step 10: Reinstall and typecheck**

```bash
cd ~/dev/misc/cashish-admin
npm install
npx tsc --noEmit -p apps/books/tsconfig.json
npx tsc --noEmit -p packages/core/tsconfig.json
```

Expected: no errors. Fix any unresolved import here rather than discovering it in a test.

- [ ] **Step 11: Run the suite**

```bash
DATABASE_URL=postgres://cashish:cashish@127.0.0.1:5470/cashish_test npm test
```

Expected: `# pass 90`, `# fail 0` — identical to Task 1 Step 1.

If `tenancy.test.ts` or `rbac.test.ts` fails, do not adjust the test — they are the isolation guardrails and a failure means the extraction changed how the tenant context or the capability map resolves. Find the import that now resolves somewhere else.

- [ ] **Step 12: Prove the migrations really run from the package**

The `migrationsFolder` change in Step 5 is the one silent-failure risk in this task, and a suite that finds the schema already applied would not catch it. Drop the test database and rebuild it from nothing:

```bash
docker exec cashish-dev-pg psql -U cashish -d cashish_dev \
  -c 'drop database cashish_test;' -c 'create database cashish_test;'
DATABASE_URL=postgres://cashish:cashish@127.0.0.1:5470/cashish_test npm test
```

Expected: `# pass 90`, `# fail 0` against a database that was empty a moment ago. Then confirm the migrations were actually recorded rather than skipped:

```bash
docker exec cashish-dev-pg psql -U cashish -d cashish_test \
  -c 'select count(*) from drizzle.__drizzle_migrations;'
```

Expected: 6 — one row per file in `packages/core/drizzle/*.sql` (`0000` through `0005`). A count of 0 with passing tests is exactly the silent failure this step exists to catch.

- [ ] **Step 13: Verify the build**

```bash
DATABASE_URL=postgres://cashish:cashish@127.0.0.1:5470/cashish_dev npm run build
```

Expected: `next build` completes, proving `transpilePackages` resolves `@cashish/core` for every route.

- [ ] **Step 14: Update the directory map in `CLAUDE.md`**

The "Directory map" and "Running it" sections describe a layout that no longer exists. Rewrite the map to match §3 of the spec, and change the commands to their workspace forms (`npm test` from the root still works; `npm run db:migrate` now delegates to `@cashish/core`). Add a line to "Conventions specific to this repo":

```markdown
**The schema lives in `packages/core`, and only there.** Both applications
import `@cashish/core/db`; neither declares a table. One database has one
schema and one migration journal, and a schema copied into an app is a schema
that drifts on the first migration somebody forgets to mirror.
```

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "Extract the database layer into @cashish/core

The admin console needs the same tables the books app has, and two apps
that each declare a schema disagree about it on the first migration one
of them forgets. Schema, pool, tenant context, RBAC policy and the
migration journal move into one package that both import.

The migrator now resolves its folder against its own module rather than
the working directory: drizzle treats a missing folder as nothing to do,
so run from the wrong place it would have reported success and applied
nothing."
```

---

## Self-Review

**Spec coverage.** This plan implements §3 (repository structure) and PRs 1–2 of §8. §4 through §7 — platform identity, the console's screens, subscriptions, limit enforcement and the new test suites — are PRs 3–7 and belong to a second plan, written once this one lands and the import paths above are real rather than predicted. §5.2's `users.disabled_at` and §6's tables are deliberately absent here; adding a column in a plan whose stated constraint is "no behaviour changes" would contradict it.

**Placeholders.** None. Every step names its command and its expected output; every code block is complete rather than elided.

**Type consistency.** `migrate()` is defined in Task 2 Step 5 and consumed in Step 9 with the same name and signature (`(): Promise<void>`). `ensureSchema()` changes from sync to async in Step 9, and Step 9 covers both its internal caller and the sweep for external ones. The `@cashish/core/db` export list in the Interfaces block matches `index.ts` in Step 4 exactly, including `tables` as the namespace name that Step 8's rewrite rule 2 depends on.

**One risk worth naming.** Step 8 rewrites imports with `perl -pi`, and a blunt substitution across 50 files can produce something that compiles but is not what was meant. Steps 10 through 13 exist to catch that: typecheck, suite, a from-empty migration with a row count, and a full build. Read the diff at Step 8 before running any of them.
