/**
 * Rate limiting on the console's sign-in.
 *
 * This is the control standing in for the production SSO that this Vercel plan
 * does not offer. The login page is publicly reachable, so these assertions are
 * what make "the password is the only thing in front of it" an acceptable
 * sentence rather than an alarming one.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { ensureSchema, scratchEmail, closePool } from "./harness";
import {
  lockState,
  recordFailure,
  clearFailures,
  sweepExpired,
  MAX_ATTEMPTS,
  MAX_ATTEMPTS_IP,
  WINDOW_MINUTES,
} from "../src/lib/login-throttle";

before(ensureSchema);
after(closePool);

beforeEach(async () => {
  const { db, schema } = await import("@cashish/core/db");
  await db.delete(schema.adminLoginAttempts);
});

test("an address locks after the threshold, and not before", async () => {
  const email = scratchEmail("lock");

  for (let n = 1; n < MAX_ATTEMPTS; n += 1) {
    await recordFailure(email, null);
    assert.equal(
      (await lockState(email, null)).locked,
      false,
      `still open after ${n} failures — the honest mistyper must not be locked out`,
    );
  }

  await recordFailure(email, null);
  const locked = await lockState(email, null);
  assert.equal(locked.locked, true, `locked at ${MAX_ATTEMPTS}`);
  assert.equal(locked.reason, "address");
});

test("one address locking does not lock a different one", async () => {
  const victim = scratchEmail("victim");
  const other = scratchEmail("other");

  for (let n = 0; n < MAX_ATTEMPTS; n += 1) await recordFailure(victim, null);

  assert.equal((await lockState(victim, null)).locked, true);
  assert.equal(
    (await lockState(other, null)).locked,
    false,
    "an attacker must not be able to lock somebody else out by guessing at them",
  );
});

test("spraying one guess each across many addresses still locks, by IP", async () => {
  const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;

  // A different address every time, so the per-address counter never fires.
  for (let n = 0; n < MAX_ATTEMPTS_IP; n += 1) {
    await recordFailure(scratchEmail(`spray${n}`), ip);
  }

  const fresh = scratchEmail("fresh");
  assert.equal(
    (await lockState(fresh, null)).locked,
    false,
    "sanity: the address counter has nothing on this one",
  );

  const locked = await lockState(fresh, ip);
  assert.equal(locked.locked, true, "but the IP counter caught it");
  assert.equal(locked.reason, "ip");
});

test("a success clears that address's failures", async () => {
  const email = scratchEmail("clears");
  for (let n = 0; n < MAX_ATTEMPTS; n += 1) await recordFailure(email, null);
  assert.equal((await lockState(email, null)).locked, true);

  await clearFailures(email);
  assert.equal(
    (await lockState(email, null)).locked,
    false,
    "getting it right starts you clean",
  );
});

test("failures outside the window do not count", async () => {
  const { db, schema } = await import("@cashish/core/db");
  const email = scratchEmail("expired");
  const old = new Date(Date.now() - (WINDOW_MINUTES + 5) * 60 * 1000).toISOString();

  await db.insert(schema.adminLoginAttempts).values(
    Array.from({ length: MAX_ATTEMPTS + 4 }, () => ({
      id: randomUUID(),
      identifier: `email:${email.toLowerCase()}`,
      attemptedAt: old,
    })),
  );

  assert.equal(
    (await lockState(email, null)).locked,
    false,
    "a lockout has to expire, or one bad afternoon locks the account forever",
  );
});

test("the sweep removes only expired rows", async () => {
  const { db, schema } = await import("@cashish/core/db");
  const email = scratchEmail("sweep");
  const old = new Date(Date.now() - (WINDOW_MINUTES + 5) * 60 * 1000).toISOString();

  await db.insert(schema.adminLoginAttempts).values({
    id: randomUUID(),
    identifier: `email:old-${email}`,
    attemptedAt: old,
  });
  await recordFailure(email, null);

  await sweepExpired();

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.adminLoginAttempts);
  assert.equal(row.count, 1, "the recent failure survives, the stale one does not");
});

test("with no IP available, the address counter still applies", async () => {
  const email = scratchEmail("noip");
  for (let n = 0; n < MAX_ATTEMPTS; n += 1) await recordFailure(email, null);
  assert.equal((await lockState(email, null)).locked, true);
});


test("one operator mistyping their own password does not lock their whole IP", async () => {
  // The regression this file exists for: with a single shared threshold, eight
  // failures on one address also locked the address the operator was about to
  // get right, because both counters had passed the same number.
  const ip = "203.0.113.77";
  const mine = scratchEmail("mine");

  for (let n = 0; n < MAX_ATTEMPTS; n += 1) await recordFailure(mine, ip);

  assert.equal((await lockState(mine, ip)).locked, true, "that address is locked, as intended");
  assert.equal(
    (await lockState(scratchEmail("colleague"), ip)).locked,
    false,
    "but the connection is not — the operator can still sign in as somebody else",
  );
});
