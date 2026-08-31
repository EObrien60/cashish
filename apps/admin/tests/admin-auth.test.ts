/**
 * The boundary between platform identity and customer identity.
 *
 * These are the assertions that make "an administrator is not a user" true by
 * construction rather than by intention. If any of them fails, the separate
 * platform_admins table has stopped buying anything and the design's central
 * claim is void — so treat a failure here as a security regression, not a
 * broken test.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { ensureSchema, scratchEmail, closePool, BOOKS_SECRET } from "./harness";
import { createAdmin, authenticate, setAdminDisabled, hashPassword, verifyPassword } from "../src/lib/admin-auth";
import { signAdminSession, verifyAdminSession } from "../src/lib/admin-session";

before(ensureSchema);
after(closePool);

test("a token signed with the books secret is not an admin session", async () => {
  const forged = await new SignJWT({ aid: "whoever" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(BOOKS_SECRET));

  assert.equal(
    await verifyAdminSession(forged),
    null,
    "a signature made with AUTH_SECRET must not verify here — that is the whole point of the separate secret",
  );
});

test("a books session payload shape is not an admin session", async () => {
  // The books session carries { uid, tid }; this one carries { aid }. Even
  // signed with the right key, the wrong claims are not a session.
  const wrongClaims = await new SignJWT({ uid: "u1", tid: "t1" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.ADMIN_AUTH_SECRET!));

  assert.equal(await verifyAdminSession(wrongClaims), null);
});

test("an admin session round-trips", async () => {
  const token = await signAdminSession({ aid: "admin-123" });
  assert.deepEqual(await verifyAdminSession(token), { aid: "admin-123" });
});

test("garbage is not a session", async () => {
  assert.equal(await verifyAdminSession("not-a-jwt"), null);
  assert.equal(await verifyAdminSession(""), null);
});

test("the right password authenticates and the wrong one does not", async () => {
  const email = scratchEmail("auth");
  await createAdmin({ email, password: "correct-horse-battery", name: "Auth Test" });

  assert.ok(await authenticate(email, "correct-horse-battery"));
  assert.equal(await authenticate(email, "correct-horse-batter"), null);
  assert.equal(await authenticate(email, ""), null);
});

test("an unknown address does not authenticate", async () => {
  assert.equal(await authenticate(scratchEmail("nobody"), "correct-horse-battery"), null);
});

test("a disabled administrator cannot authenticate", async () => {
  const email = scratchEmail("disabled");
  const id = await createAdmin({ email, password: "correct-horse-battery" });
  assert.ok(await authenticate(email, "correct-horse-battery"), "sanity: works before disabling");

  await setAdminDisabled(id, true);
  assert.equal(
    await authenticate(email, "correct-horse-battery"),
    null,
    "disabling must take effect immediately, not when a token expires",
  );

  await setAdminDisabled(id, false);
  assert.ok(await authenticate(email, "correct-horse-battery"), "and it must be reversible");
});

test("a password under twelve characters is refused", async () => {
  await assert.rejects(
    () => createAdmin({ email: scratchEmail("short"), password: "elevenchar" }),
    /at least 12/,
  );
});

test("a duplicate address is refused", async () => {
  const email = scratchEmail("dupe");
  await createAdmin({ email, password: "correct-horse-battery" });
  await assert.rejects(
    () => createAdmin({ email, password: "correct-horse-battery" }),
    /already an administrator/,
  );
});

test("email is normalised, so case cannot create a second account", async () => {
  const email = scratchEmail("Case");
  await createAdmin({ email: email.toUpperCase(), password: "correct-horse-battery" });
  assert.ok(await authenticate(email.toLowerCase(), "correct-horse-battery"));
});

test("password hashes are salted, so two identical passwords differ", async () => {
  const a = await hashPassword("correct-horse-battery");
  const b = await hashPassword("correct-horse-battery");
  assert.notEqual(a, b);
  assert.ok(await verifyPassword("correct-horse-battery", a));
  assert.ok(await verifyPassword("correct-horse-battery", b));
});

test("a malformed stored hash fails closed rather than throwing", async () => {
  assert.equal(await verifyPassword("anything", "not-a-hash"), false);
  assert.equal(await verifyPassword("anything", ""), false);
  assert.equal(await verifyPassword("anything", "abc:"), false);
});

test("a shared signing secret is refused outright", async () => {
  // The secret is read at call time, so this can be exercised in process.
  const admin = process.env.ADMIN_AUTH_SECRET;
  const books = process.env.AUTH_SECRET;
  try {
    process.env.AUTH_SECRET = "the-very-same-secret-000000000000000000";
    process.env.ADMIN_AUTH_SECRET = "the-very-same-secret-000000000000000000";
    await assert.rejects(
      () => signAdminSession({ aid: "whoever" }),
      /must not equal AUTH_SECRET/,
      "sharing the key silently re-couples the two identities; it has to fail loudly",
    );
  } finally {
    process.env.ADMIN_AUTH_SECRET = admin;
    process.env.AUTH_SECRET = books;
  }
});

test("a secret shorter than 32 characters is refused", async () => {
  const admin = process.env.ADMIN_AUTH_SECRET;
  try {
    process.env.ADMIN_AUTH_SECRET = "too-short";
    await assert.rejects(() => signAdminSession({ aid: "whoever" }), /at least|>= 32|too short/i);
  } finally {
    process.env.ADMIN_AUTH_SECRET = admin;
  }
});
