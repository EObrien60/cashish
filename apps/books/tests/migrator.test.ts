/**
 * Which connection the migrator opens.
 *
 * Not a detail: `pg_advisory_lock` is session-scoped, and a pooled endpoint
 * gives each statement whichever backend is free — so the lock is taken on one
 * connection while the migration runs on another, holding nothing. Two
 * deployments of the same commit then migrate at once, which is how a books
 * build died on `pg_type_typname_nsp_index` while the admin build applied the
 * same migration.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { migrationConnectionString } from "@cashish/core/migrate";

test("a direct connection is preferred over the pooled one", () => {
  const chosen = migrationConnectionString({
    DATABASE_URL: "postgres://pooled.example/db",
    DATABASE_URL_UNPOOLED: "postgres://direct.example/db",
  });
  assert.equal(chosen, "postgres://direct.example/db");
});

test("the Vercel integration's own name for it is understood too", () => {
  const chosen = migrationConnectionString({
    DATABASE_URL: "postgres://pooled.example/db",
    POSTGRES_URL_NON_POOLING: "postgres://direct.example/db",
  });
  assert.equal(chosen, "postgres://direct.example/db");
});

test("with only DATABASE_URL — dev, CI — that is what is used", () => {
  const chosen = migrationConnectionString({ DATABASE_URL: "postgres://localhost:5470/db" });
  assert.equal(chosen, "postgres://localhost:5470/db");
});

test("nothing configured is nothing chosen, so the caller can say so", () => {
  assert.equal(migrationConnectionString({}), undefined);
});
