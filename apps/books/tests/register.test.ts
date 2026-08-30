/**
 * Signing up.
 *
 * This is the only path into cashish that does not require an existing member to
 * let you in, so what it creates has to be right: a user, a business of their
 * own, ownership of it, and a slug that does not collide with somebody else's.
 *
 * Exercises the same functions the server action composes; the action itself only
 * adds form parsing and a redirect.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import { ensureSchema, asTenant, closePool } from "./harness";
import { db, schema } from "@cashish/core/db";
import { createUser, findUserByEmail, addMembership, membershipsFor, authenticate } from "../src/lib/auth";
import { createTenant, findTenantBySlug } from "../src/db/seed";
import { listVatRates, listCategories, getSettings } from "../src/lib/lookups";
import { uid } from "../src/lib/id";

/** Mirrors the slug derivation in the register action. */
async function slugFor(businessName: string) {
  const base =
    businessName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "business";
  let slug = base;
  for (let n = 2; await findTenantBySlug(slug); n += 1) slug = `${base}-${n}`;
  return slug;
}

before(ensureSchema);
after(closePool);

test("a fresh signup gets a usable, isolated business", async () => {
  const email = `signup-${uid().slice(0, 8)}@example.com`;
  const businessName = `Harbour Test ${uid().slice(0, 6)}`;

  const userId = await createUser({ email, password: "a-long-enough-passphrase", name: "New Owner" });
  const slug = await slugFor(businessName);
  const tenantId = await createTenant({ slug, name: businessName });
  await addMembership(userId, tenantId, "owner");

  const memberships = await membershipsFor(userId);
  assert.equal(memberships.length, 1);
  assert.equal(memberships[0].role, "owner", "you own what you just created");
  assert.equal(memberships[0].tenantId, tenantId);

  await asTenant(tenantId, async () => {
    // Seeded and ready to use, not an empty shell.
    assert.equal((await listVatRates()).length, 5, "Irish VAT rates are there");
    assert.equal((await listCategories()).length, 15, "and a chart of accounts");
    const settings = await getSettings();
    assert.equal(settings.businessName, businessName);
    assert.equal(settings.vatBasis, "cash");
  });

  // And the credentials work.
  assert.ok(await authenticate(email, "a-long-enough-passphrase"));
  assert.equal(await authenticate(email, "wrong"), null);
});

test("two businesses with the same name get different slugs", async () => {
  const name = `Duplicate Name ${uid().slice(0, 6)}`;
  const first = await slugFor(name);
  await createTenant({ slug: first, name });
  const second = await slugFor(name);
  assert.notEqual(second, first, "the second must not collide");
  assert.match(second, /-2$/);
  await createTenant({ slug: second, name });

  // Both exist, separately.
  assert.ok(await findTenantBySlug(first));
  assert.ok(await findTenantBySlug(second));
});

test("a business name of only punctuation still yields a slug", async () => {
  const slug = await slugFor("!!! ???");
  assert.match(slug, /^business/, "falls back rather than producing an empty slug");
});

test("an address can only be registered once", async () => {
  const email = `dupe-${uid().slice(0, 8)}@example.com`;
  await createUser({ email, password: "a-long-enough-passphrase" });
  assert.ok(await findUserByEmail(email), "the check the action relies on");
  // Case and whitespace must not create a second account for the same person.
  assert.ok(await findUserByEmail(` ${email.toUpperCase()} `));
});
