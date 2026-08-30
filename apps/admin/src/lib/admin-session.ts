import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { findAdminById, recordLogin } from "./admin-auth";
import { ADMIN_SESSION_COOKIE } from "./admin-session-cookie";

// ---------------------------------------------------------------------------
// The administrator's browser session.
//
// A signed JWT in an httpOnly cookie carrying only { aid }. Three things make
// it deliberately unlike the books session:
//
//   1. Its own secret. ADMIN_AUTH_SECRET, never AUTH_SECRET. This is the whole
//      point of separating the identities: a total compromise of the books
//      signing key lets an attacker mint any customer session they like and
//      buys them nothing here, because this verifier will not accept a
//      signature made with it.
//   2. Eight hours, not fourteen days. A stale customer session is one set of
//      books; a stale admin session is all of them.
//   3. Re-read on every request. The row is fetched each time so that disabling
//      an administrator takes effect on their next request rather than whenever
//      their token happens to expire.
// ---------------------------------------------------------------------------

export { ADMIN_SESSION_COOKIE } from "./admin-session-cookie";

const MAX_AGE_SECONDS = 60 * 60 * 8;

function secret(): Uint8Array {
  const value = process.env.ADMIN_AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      "ADMIN_AUTH_SECRET is missing or too short (needs >= 32 chars). " +
        "Generate one with: openssl rand -base64 48",
    );
  }
  // A shared secret would silently re-couple the two identities and undo the
  // reason this table is separate at all. Refuse to start rather than run in a
  // configuration whose whole security argument is void.
  if (process.env.AUTH_SECRET && value === process.env.AUTH_SECRET) {
    throw new Error(
      "ADMIN_AUTH_SECRET must not equal AUTH_SECRET. Sharing the signing key " +
        "means a stolen customer session cookie is an administrator session " +
        "cookie, which is exactly what the separate platform_admins table exists " +
        "to prevent. Generate a distinct one: openssl rand -base64 48",
    );
  }
  return new TextEncoder().encode(value);
}

export type AdminClaims = { aid: string };

export async function signAdminSession(claims: AdminClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
}

export async function verifyAdminSession(token: string): Promise<AdminClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const aid = payload.aid;
    if (typeof aid !== "string") return null;
    return { aid };
  } catch {
    return null;
  }
}

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_SECONDS,
};

export async function setAdminSessionCookie(claims: AdminClaims) {
  const jar = await cookies();
  jar.set(ADMIN_SESSION_COOKIE, await signAdminSession(claims), cookieOptions);
  await recordLogin(claims.aid);
}

export async function clearAdminSessionCookie() {
  const jar = await cookies();
  jar.set(ADMIN_SESSION_COOKIE, "", { ...cookieOptions, maxAge: 0 });
}

export type AdminIdentity = { id: string; email: string; name: string };

/** The current administrator, re-verified against the table on every call. */
export async function currentAdmin(): Promise<AdminIdentity | null> {
  const jar = await cookies();
  const token = jar.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return null;
  const claims = await verifyAdminSession(token);
  if (!claims) return null;
  const admin = await findAdminById(claims.aid);
  // A valid token for an account that is gone or disabled is not a session.
  if (!admin || admin.disabledAt) return null;
  return { id: admin.id, email: admin.email, name: admin.name };
}

/** For pages. Sends anyone without a session to the sign-in screen. */
export async function requireAdmin(): Promise<AdminIdentity> {
  const admin = await currentAdmin();
  if (!admin) redirect("/login");
  return admin;
}
