"use server";

import { redirect } from "next/navigation";
import { authenticate } from "@/lib/admin-auth";
import { setAdminSessionCookie, clearAdminSessionCookie } from "@/lib/admin-session";

/**
 * Sign in.
 *
 * One message for every failure. Telling the visitor whether the address exists
 * would hand an attacker a way to enumerate which addresses are platform
 * administrators, and that list is worth more than the convenience is.
 */
export async function signIn(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/tenants");

  if (!email || !password) return { error: "Enter an email address and a password." };

  const admin = await authenticate(email, password);
  if (!admin) return { error: "Those credentials were not accepted." };

  await setAdminSessionCookie({ aid: admin.id });
  // Only ever a path on this host: an open redirect on a console login is a
  // free phishing landing page.
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/tenants");
}

export async function logout() {
  await clearAdminSessionCookie();
  redirect("/login");
}
