import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";
import { db, first, schema } from "@cashish/core/db";
import { uid } from "./id";
import { isRole, type Role } from "@cashish/core/rbac";

const scrypt = promisify(scryptCb);
const { users, memberships, tenants, apiKeys } = schema;

// ---------------------------------------------------------------------------
// Passwords, users, memberships and API keys.
//
// No external auth dependency: scrypt from node:crypto is the right primitive
// and adding a provider would mean another secret to rotate and another outage
// to inherit.
//
// Nothing here reads the tenant context — this module is what *establishes* it,
// so it must work before a tenant is known and therefore queries `db` directly
// with explicit filters.
// ---------------------------------------------------------------------------

const SCRYPT_KEYLEN = 64;

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

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const normaliseEmail = (email: string) => email.trim().toLowerCase();

export async function findUserByEmail(email: string) {
  return first(
    await db.select().from(users).where(eq(users.email, normaliseEmail(email))).limit(1),
  );
}

export async function createUser(input: { email: string; password: string; name?: string }) {
  const id = uid();
  await db.insert(users).values({
    id,
    email: normaliseEmail(input.email),
    passwordHash: await hashPassword(input.password),
    name: input.name ?? "",
  });
  return id;
}

export async function setUserPassword(userId: string, password: string) {
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(users.id, userId));
}

/**
 * Authenticates an email/password pair.
 *
 * Runs the scrypt comparison against a dummy hash when the user does not exist,
 * so a missing account and a wrong password take the same time and the response
 * does not disclose which addresses are registered.
 */
const DUMMY_HASH = `${"0".repeat(32)}:${"0".repeat(128)}`;

export async function authenticate(email: string, password: string) {
  const user = await findUserByEmail(email);
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  return ok && user ? user : null;
}

export type MembershipRow = { tenantId: string; slug: string; name: string; role: Role };

export async function membershipsFor(userId: string): Promise<MembershipRow[]> {
  const rows = await db
    .select({
      tenantId: memberships.tenantId,
      role: memberships.role,
      slug: tenants.slug,
      name: tenants.name,
    })
    .from(memberships)
    .innerJoin(tenants, eq(memberships.tenantId, tenants.id))
    .where(eq(memberships.userId, userId));
  return rows
    .filter((r) => isRole(r.role))
    .map((r) => ({ tenantId: r.tenantId, slug: r.slug, name: r.name, role: r.role as Role }));
}

/**
 * The authoritative role for a user in a tenant.
 *
 * Looked up per request rather than trusted from the session cookie, so
 * revoking a membership or demoting someone takes effect on their very next
 * request instead of whenever their token happens to expire.
 */
/**
 * The role this person holds in this tenant, or null.
 *
 * Joined against `users` so that a disabled account resolves to null: a
 * platform administrator disabling somebody must take effect on that person's
 * next request, not whenever their fourteen-day cookie happens to expire. This
 * is the same reasoning that keeps the role out of the token — a session is a
 * cache of who you are, never of what you may do.
 */
export async function roleFor(userId: string, tenantIdValue: string): Promise<Role | null> {
  const row = first(
    await db
      .select({ role: memberships.role, disabledAt: users.disabledAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantIdValue)))
      .limit(1),
  );
  if (!row || row.disabledAt) return null;
  return isRole(row.role) ? row.role : null;
}

export async function addMembership(userId: string, tenantIdValue: string, role: Role) {
  await db
    .insert(memberships)
    .values({ userId, tenantId: tenantIdValue, role })
    .onConflictDoUpdate({
      target: [memberships.userId, memberships.tenantId],
      set: { role },
    });
}

// --- API keys ---------------------------------------------------------------

const KEY_PREFIX = "ck_live_";

/** Returns the plaintext key exactly once; only its hash is persisted. */
export async function createApiKey(input: {
  tenantId: string;
  name: string;
  role: Role;
  createdBy: string | null;
}): Promise<{ id: string; key: string }> {
  const id = uid();
  const secret = randomBytes(32).toString("base64url");
  const key = `${KEY_PREFIX}${secret}`;
  await db.insert(apiKeys).values({
    id,
    tenantId: input.tenantId,
    name: input.name,
    // Enough to locate one row without being enough to use.
    prefix: secret.slice(0, 12),
    keyHash: sha256(key),
    role: input.role,
    createdBy: input.createdBy,
  });
  return { id, key };
}

export type ResolvedCredential = { tenantId: string; role: Role; actor: string };

export async function resolveApiKey(key: string): Promise<ResolvedCredential | null> {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const secret = key.slice(KEY_PREFIX.length);
  const row = first(
    await db.select().from(apiKeys).where(eq(apiKeys.prefix, secret.slice(0, 12))).limit(1),
  );
  if (!row || row.revokedAt) return null;

  const expected = Buffer.from(row.keyHash, "utf8");
  const actual = Buffer.from(sha256(key), "utf8");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  if (!isRole(row.role)) return null;

  // Fire-and-forget: a failed bookkeeping write must not fail the request.
  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(eq(apiKeys.id, row.id))
    .catch(() => {});

  return { tenantId: row.tenantId, role: row.role, actor: `apikey:${row.id}` };
}

export async function listApiKeys(tenantIdValue: string) {
  return db.select().from(apiKeys).where(eq(apiKeys.tenantId, tenantIdValue));
}

export async function revokeApiKey(tenantIdValue: string, id: string) {
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(eq(apiKeys.tenantId, tenantIdValue), eq(apiKeys.id, id)));
}
