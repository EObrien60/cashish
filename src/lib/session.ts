import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { roleFor } from "./auth";
import type { Role } from "./rbac";

// ---------------------------------------------------------------------------
// The browser session.
//
// A signed JWT in an httpOnly cookie carrying only { uid, tid }. The ROLE IS
// NOT IN THE TOKEN: it is looked up from memberships on every request, so
// demoting or removing someone takes effect immediately rather than whenever
// their token happens to expire. A cookie is a cache of who you are, never of
// what you may do.
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = "cashish_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // 14 days

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      "AUTH_SECRET is missing or too short (needs >= 32 chars). " +
        "Generate one with: openssl rand -base64 48",
    );
  }
  return new TextEncoder().encode(value);
}

export type SessionClaims = { uid: string; tid: string };

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const uid = payload.uid;
    const tid = payload.tid;
    if (typeof uid !== "string" || typeof tid !== "string") return null;
    return { uid, tid };
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

export async function setSessionCookie(claims: SessionClaims) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await signSession(claims), cookieOptions);
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", { ...cookieOptions, maxAge: 0 });
}

export type Session = { userId: string; tenantId: string; role: Role };

/** The current session, with the role re-verified against memberships. */
export async function currentSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const claims = await verifySession(token);
  if (!claims) return null;
  const role = await roleFor(claims.uid, claims.tid);
  // A valid token for a membership that no longer exists is not a session.
  if (!role) return null;
  return { userId: claims.uid, tenantId: claims.tid, role };
}
