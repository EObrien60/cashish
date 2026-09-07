import { Resend } from "resend";
import { db, schema, first } from "./db/client";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Transactional email is a PLATFORM capability, not a per-tenant one — one
// verified sending domain, one provider account, used to send on every
// tenant's behalf (their business name goes in the "from" display name; the
// sending domain and API key are cashish's own). A tenant never configures
// their own email provider — see platformSettings, editable only from the
// admin console.
//
// Lazy client construction, same reason as db/client.ts and stripe.ts.
// ---------------------------------------------------------------------------

const { platformSettings } = schema;

export type PlatformEmailSettings = {
  apiKey: string;
  fromAddress: string;
  fromName: string;
};

/** Reads the platform's own email config. Returns null if not configured yet. */
export async function getPlatformEmailSettings(): Promise<PlatformEmailSettings | null> {
  const row = first(
    await db.select().from(platformSettings).where(eq(platformSettings.id, "singleton")).limit(1),
  );
  if (!row?.emailApiKey || !row.emailFromAddress) return null;
  return {
    apiKey: row.emailApiKey,
    fromAddress: row.emailFromAddress,
    fromName: row.emailFromName || "cashish",
  };
}

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  /** Overrides platformSettings.emailFromName for this one send, e.g. the tenant's own business name. */
  fromName?: string;
  replyTo?: string;
};

/**
 * Sends one email through the platform's Resend account.
 *
 * Throws if the platform isn't configured yet (an admin hasn't set an email
 * API key) — callers decide whether that's fatal to their flow or something
 * to catch and surface as "email not set up yet."
 */
export async function sendEmail({ to, subject, html, fromName, replyTo }: SendEmailInput) {
  const settings = await getPlatformEmailSettings();
  if (!settings) {
    throw new Error(
      "Email is not configured for this platform yet — set an email API key and " +
        "from-address in the admin console.",
    );
  }
  const resend = new Resend(settings.apiKey);
  const from = `${fromName ?? settings.fromName} <${settings.fromAddress}>`;
  const result = await resend.emails.send({ from, to, subject, html, replyTo });
  if (result.error) {
    throw new Error(`Email send failed: ${result.error.message}`);
  }
  return result.data;
}
