import { randomBytes, scrypt as scryptCb, timingSafeEqual, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { db, first, schema } from "@cashish/core/db";

// ---------------------------------------------------------------------------
// Platform administrator identity.
//
// A separate table from `users`, with no foreign key between them. The password
// FORMAT is the same as the books app's — scrypt, "<saltHex>:<derivedKeyHex>" —
// because that is simply the right primitive, but a shared format is not a
// shared credential: the two are never looked up in the same place, so an
// administrator's password can never authenticate a customer session and a
// customer's can never authenticate here.
//
// Nothing in this module runs inside a tenant context, and it must not: an
// administrator does not belong to a tenant. It queries `db` directly.
// ---------------------------------------------------------------------------

const scrypt = promisify(scryptCb);
const SCRYPT_KEYLEN = 64;
const { platformAdmins } = schema;

export const MIN_PASSWORD_LENGTH = 12;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scrypt(plain, salt, SCRYPT_KEYLEN)) as Buffer;
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;
  const key = (await scrypt(plain, Buffer.from(saltHex, "hex"), SCRYPT_KEYLEN)) as Buffer;
  const expected = Buffer.from(keyHex, "hex");
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (expected.length !== key.length) return false;
  return timingSafeEqual(expected, key);
}

const normaliseEmail = (email: string) => email.trim().toLowerCase();

export async function findAdminByEmail(email: string) {
  return first(
    await db
      .select()
      .from(platformAdmins)
      .where(eq(platformAdmins.email, normaliseEmail(email)))
      .limit(1),
  );
}

export async function findAdminById(id: string) {
  return first(
    await db.select().from(platformAdmins).where(eq(platformAdmins.id, id)).limit(1),
  );
}

/**
 * Creates an administrator. Called by the CLI and by tests — never by a route.
 *
 * There is no self-serve path into this table on purpose: a console that can
 * suspend a business and rewrite its plan should not have a sign-up form, and
 * there is no growth argument for one.
 */
export async function createAdmin(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<string> {
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  const email = normaliseEmail(input.email);
  if (await findAdminByEmail(email)) {
    throw new Error(`There is already an administrator with the address ${email}.`);
  }
  const id = randomUUID();
  await db.insert(platformAdmins).values({
    id,
    email,
    passwordHash: await hashPassword(input.password),
    name: input.name ?? "",
  });
  return id;
}

const nowISO = () => new Date().toISOString();

export async function recordLogin(id: string): Promise<void> {
  await db
    .update(platformAdmins)
    .set({ lastLoginAt: nowISO() })
    .where(eq(platformAdmins.id, id));
}

export async function setAdminDisabled(id: string, disabled: boolean): Promise<void> {
  await db
    .update(platformAdmins)
    .set({ disabledAt: disabled ? nowISO() : null })
    .where(eq(platformAdmins.id, id));
}

/**
 * Verifies a sign-in attempt.
 *
 * Returns null for every failure — unknown address, wrong password, disabled
 * account — because distinguishing them at the login screen tells an attacker
 * which addresses are administrators, and that is a list worth guarding.
 */
export async function authenticate(email: string, password: string) {
  const admin = await findAdminByEmail(email);
  if (!admin) {
    // Spend the same work as a real verification so that a missing address is
    // not detectably faster than a wrong password.
    await verifyPassword(password, `${"0".repeat(32)}:${"0".repeat(128)}`);
    return null;
  }
  if (admin.disabledAt) return null;
  if (!(await verifyPassword(password, admin.passwordHash))) return null;
  return admin;
}
