/**
 * The session cookie's name, and nothing else.
 *
 * Deliberately its own module with no imports: middleware runs in a constrained
 * bundle, and reaching into src/lib/session.ts for this constant dragged
 * node:crypto (via the password hashing in auth.ts) into that bundle and broke
 * the build. Middleware needs the name, not the machinery.
 */
export const SESSION_COOKIE = "cashish_session";
