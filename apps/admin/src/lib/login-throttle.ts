import { randomUUID } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@cashish/core/db";

// ---------------------------------------------------------------------------
// Rate limiting on the console's sign-in.
//
// Why this exists: Vercel Authentication is not available for production
// deployments on this plan, so unlike the books app's previews, this console's
// login page is reachable by anyone who finds the URL. The password is the only
// thing in front of it, and a password with an unlimited guessing rate is a
// weaker control than it looks.
//
// Two counters, and either one can lock:
//
//   - by ADDRESS, so a single account cannot be ground down;
//   - by IP, so spraying one guess each across a list of addresses is not a way
//     around the first counter.
//
// A locked attempt is refused BEFORE the password is checked, which also means
// the expensive scrypt verification is not a lever an attacker can pull.
//
// Failures only are recorded, and a success clears the address's failures — so
// the honest user who mistypes twice and then gets it right starts clean.
// ---------------------------------------------------------------------------

const { adminLoginAttempts } = schema;

/**
 * Two thresholds, not one, and the IP's is deliberately much higher.
 *
 * With a single threshold the IP counter locks the console for the legitimate
 * operator: mistype your own password eight times and every address from your
 * connection is refused, including the one you were about to get right. That
 * was observed, not theorised — it happened the first time this was driven
 * through the real form.
 *
 * The address counter is the one that defends an account, so it stays tight.
 * The IP counter only has to make spraying a list uneconomic, and 24 in a
 * quarter of an hour does that while leaving an honest person who fumbles two
 * or three different addresses plenty of room.
 */
export const MAX_ATTEMPTS = 8;
export const MAX_ATTEMPTS_IP = 24;
export const WINDOW_MINUTES = 15;

const windowStart = () =>
  new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

const addressKey = (email: string) => `email:${email.trim().toLowerCase()}`;
const ipKey = (ip: string) => `ip:${ip}`;

async function countRecent(identifier: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(adminLoginAttempts)
    .where(
      and(
        eq(adminLoginAttempts.identifier, identifier),
        gte(adminLoginAttempts.attemptedAt, windowStart()),
      ),
    );
  return row?.count ?? 0;
}

export type LockState = { locked: boolean; reason?: "address" | "ip" };

/** Checked before the password is verified. */
export async function lockState(email: string, ip: string | null): Promise<LockState> {
  if (await countRecent(addressKey(email)) >= MAX_ATTEMPTS) {
    return { locked: true, reason: "address" };
  }
  if (ip && (await countRecent(ipKey(ip))) >= MAX_ATTEMPTS_IP) {
    return { locked: true, reason: "ip" };
  }
  return { locked: false };
}

export async function recordFailure(email: string, ip: string | null): Promise<void> {
  const rows = [{ id: randomUUID(), identifier: addressKey(email) }];
  if (ip) rows.push({ id: randomUUID(), identifier: ipKey(ip) });
  await db.insert(adminLoginAttempts).values(rows);
}

/** A correct password clears that address's failures, but not the IP's. */
export async function clearFailures(email: string): Promise<void> {
  await db.delete(adminLoginAttempts).where(eq(adminLoginAttempts.identifier, addressKey(email)));
}

/**
 * Old rows are only noise once the window has passed. Swept on success rather
 * than on a schedule: there is no cron here, and the table is small enough that
 * an occasional delete costs nothing.
 */
export async function sweepExpired(): Promise<void> {
  await db
    .delete(adminLoginAttempts)
    .where(sql`${adminLoginAttempts.attemptedAt} < ${windowStart()}`);
}

export const LOCKED_MESSAGE =
  "Too many attempts. Wait a few minutes and try again.";
