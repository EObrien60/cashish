/**
 * The import boundary.
 *
 * This is the only test here that fails for a design reason rather than a logic
 * one, and the import it forbids is the one a future change will most want to
 * add: apps/books already has a function that does nearly what a console screen
 * needs, and reaching for it is the natural move.
 *
 * It must not happen. Everything in apps/books assumes a tenant context, and
 * this application deliberately runs without one. Borrowing a tenant-scoped
 * function here either throws at runtime — the loud failure @cashish/core/db
 * promises — or, worse, quietly reads whichever tenant happened to be in scope.
 * The console shares the schema with the books app and nothing else.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ADMIN_SRC = fileURLToPath(new URL("../src", import.meta.url));
const ADMIN_SCRIPTS = fileURLToPath(new URL("../scripts", import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const FORBIDDEN = [
  { pattern: /from\s+["']@cashish\/books/, why: "the books workspace by name" },
  { pattern: /from\s+["'][^"']*apps\/books/, why: "a path into apps/books" },
  { pattern: /require\(\s*["'][^"']*apps\/books/, why: "a require into apps/books" },
];

test("no file in the admin app imports from apps/books", () => {
  const files = [...walk(ADMIN_SRC), ...walk(ADMIN_SCRIPTS)];
  assert.ok(files.length > 0, "sanity: the walk found files");

  const offences: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const { pattern, why } of FORBIDDEN) {
      if (pattern.test(source)) {
        offences.push(`${relative(ADMIN_SRC, file)} imports ${why}`);
      }
    }
  }

  assert.deepEqual(
    offences,
    [],
    "the admin app must share the schema with the books app and nothing else",
  );
});

test("no file in the admin app escapes its workspace with a relative path", () => {
  const files = [...walk(ADMIN_SRC), ...walk(ADMIN_SCRIPTS)];
  const offences: string[] = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    // `../../..` or deeper from anywhere under src/ leaves apps/admin.
    for (const match of source.matchAll(/from\s+["'](\.\.\/){3,}([^"']*)["']/g)) {
      offences.push(`${relative(ADMIN_SRC, file)} reaches out to ${match[0]}`);
    }
  }

  assert.deepEqual(offences, [], "reach for @cashish/core, not for a path out of the app");
});

test("the admin app does not establish a tenant context", () => {
  // runInTenant is the books app's entry-point wrapper. Calling it here would
  // mean a console query had silently become tenant-scoped.
  const files = walk(ADMIN_SRC);
  const offences = files.filter((file) => /\brunInTenant\s*\(/.test(readFileSync(file, "utf8")));

  assert.deepEqual(
    offences.map((f) => relative(ADMIN_SRC, f)),
    [],
    "console queries are deliberately cross-tenant; scoping one is a bug, not a fix",
  );
});
