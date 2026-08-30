/**
 * The admin session cookie's name, and nothing else.
 *
 * Its own module with no imports, for the same reason the books app has one:
 * middleware runs in a constrained bundle, and reaching into admin-session.ts
 * for this constant would drag `jose` — and through it `node:crypto` — into
 * that bundle and break the build.
 *
 * The name differs from the books cookie so that a browser holding both sends
 * each to the app that understands it, and so neither can be mistaken for the
 * other in a request log.
 */
export const ADMIN_SESSION_COOKIE = "cashish_admin_session";
