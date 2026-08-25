/**
 * The permission policy.
 *
 * Roles are checked through one capability map so the UI, the API routes and the
 * MCP tools cannot disagree. This asserts the whole matrix explicitly rather
 * than spot-checking, because a silent widening (a viewer gaining books:write)
 * would otherwise be invisible.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { asTenant, makeTenant, closePool } from "./harness";
import { can, requireCapability, ForbiddenError, ROLES, CAPABILITIES, scopesForRole } from "../src/lib/rbac";
import { createApiKey, resolveApiKey, revokeApiKey, hashPassword, verifyPassword, authenticate, createUser, addMembership, roleFor } from "../src/lib/auth";

let tenant: string;
before(async () => {
  tenant = (await makeTenant("rbac")).id;
});
after(closePool);

test("the capability matrix is exactly as intended", () => {
  const matrix = Object.fromEntries(
    ROLES.map((role) => [role, CAPABILITIES.filter((c) => can(role, c))]),
  );
  assert.deepEqual(matrix, {
    owner: ["books:read", "books:write", "books:import", "settings:write", "tenant:admin", "tenant:delete"],
    accountant: ["books:read", "books:write", "books:import"],
    viewer: ["books:read"],
  });
});

test("a viewer cannot write, import, or administer", () => {
  assert.doesNotThrow(() => requireCapability("viewer", "books:read"));
  for (const capability of ["books:write", "books:import", "settings:write", "tenant:admin", "tenant:delete"] as const) {
    assert.throws(() => requireCapability("viewer", capability), ForbiddenError, capability);
  }
});

test("an accountant cannot touch settings, users or the tenant itself", () => {
  for (const capability of ["settings:write", "tenant:admin", "tenant:delete"] as const) {
    assert.throws(() => requireCapability("accountant", capability), ForbiddenError, capability);
  }
});

test("OAuth scopes never exceed the granting role", () => {
  assert.deepEqual(scopesForRole("owner"), ["books:read", "books:write"]);
  assert.deepEqual(scopesForRole("accountant"), ["books:read", "books:write"]);
  assert.deepEqual(scopesForRole("viewer"), ["books:read"], "a viewer cannot mint a write token");
});

test("passwords verify, and a wrong one does not", async () => {
  const stored = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery staple", stored), true);
  assert.equal(await verifyPassword("Correct horse battery staple", stored), false);
  assert.equal(await verifyPassword("", stored), false);
  assert.notEqual(stored, await hashPassword("correct horse battery staple"), "salted, so hashes differ");
});

test("authenticate refuses an unknown address without disclosing it", async () => {
  assert.equal(await authenticate("nobody@example.com", "whatever"), null);
  const email = `rbac-${Date.now()}@example.com`;
  await createUser({ email, password: "s3cret-passphrase" });
  assert.equal(await authenticate(email, "wrong"), null);
  assert.ok(await authenticate(email, "s3cret-passphrase"));
  // Case and whitespace are normalised, so the same person logs in either way.
  assert.ok(await authenticate(` ${email.toUpperCase()} `, "s3cret-passphrase"));
});

test("role comes from memberships, so it can be changed and revoked", async () => {
  const email = `member-${Date.now()}@example.com`;
  const userId = await createUser({ email, password: "s3cret-passphrase" });
  assert.equal(await roleFor(userId, tenant), null, "no membership means no role");

  await addMembership(userId, tenant, "viewer");
  assert.equal(await roleFor(userId, tenant), "viewer");

  await addMembership(userId, tenant, "owner");
  assert.equal(await roleFor(userId, tenant), "owner", "re-adding upgrades rather than duplicating");
});

test("an API key carries its own role, and revoking it takes effect", async () => {
  const { id, key } = await createApiKey({
    tenantId: tenant,
    name: "read only",
    role: "viewer",
    createdBy: null,
  });
  assert.ok(key.startsWith("ck_live_"));

  const resolved = await resolveApiKey(key);
  assert.equal(resolved?.tenantId, tenant);
  assert.equal(resolved?.role, "viewer");
  assert.equal(can(resolved!.role, "books:write"), false, "a viewer key cannot write");

  assert.equal(await resolveApiKey(`${key}x`), null, "a tampered key does not resolve");
  assert.equal(await resolveApiKey("not-a-cashish-key"), null);

  await revokeApiKey(tenant, id);
  assert.equal(await resolveApiKey(key), null, "revoked means revoked");
});
