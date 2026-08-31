"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authenticate } from "@/lib/admin-auth";
import { setAdminSessionCookie, clearAdminSessionCookie } from "@/lib/admin-session";
import {
  lockState,
  recordFailure,
  clearFailures,
  sweepExpired,
  LOCKED_MESSAGE,
} from "@/lib/login-throttle";

/**
 * The caller's address, as Vercel reports it.
 *
 * `x-forwarded-for` is a list when there are proxies in front; the first entry
 * is the client. Null when there is no header at all (local dev), and the
 * throttle then falls back to counting by address only — which is the right
 * degradation, since inventing an identifier would rate-limit every local
 * caller as if they were one.
 */
async function callerIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return h.get("x-real-ip");
}

/**
 * Sign in.
 *
 * One message for every failure — unknown address, wrong password, disabled
 * account. Telling the visitor which it was would hand an attacker a way to
 * enumerate who the platform administrators are, and that list is worth more
 * than the convenience.
 *
 * Rate-limited before the password is checked (see login-throttle.ts): this
 * console's production login page is publicly reachable, so an unlimited
 * guessing rate would be the real exposure rather than the password itself.
 */
export async function signIn(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/tenants");

  if (!email || !password) return { error: "Enter an email address and a password." };

  const ip = await callerIp();

  const lock = await lockState(email, ip);
  if (lock.locked) return { error: LOCKED_MESSAGE };

  const admin = await authenticate(email, password);
  if (!admin) {
    await recordFailure(email, ip);
    return { error: "Those credentials were not accepted." };
  }

  await clearFailures(email);
  await sweepExpired();
  await setAdminSessionCookie({ aid: admin.id });

  // Only ever a path on this host: an open redirect on a console login is a
  // free phishing landing page.
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/tenants");
}

export async function logout() {
  await clearAdminSessionCookie();
  redirect("/login");
}
