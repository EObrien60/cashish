import sgMail from "@sendgrid/mail";
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
// Two providers, one call site: `sendEmail` is what everything else imports,
// and it never needs to know which one is configured. Adding a third means
// adding one branch here and one <option> on the admin settings page — no
// other file changes.
//
// Lazy client construction, same reason as db/client.ts and stripe.ts: an SDK
// is only touched inside sendEmail, never at module load, or `next build`
// would need a live API key to build at all.
// ---------------------------------------------------------------------------

const { platformSettings } = schema;

export const EMAIL_PROVIDERS = ["sendgrid", "resend"] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

export function isEmailProvider(value: unknown): value is EmailProvider {
  return typeof value === "string" && (EMAIL_PROVIDERS as readonly string[]).includes(value);
}

export type PlatformEmailSettings = {
  provider: EmailProvider;
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
  const provider = isEmailProvider(row.emailProvider) ? row.emailProvider : "sendgrid";
  return {
    provider,
    apiKey: row.emailApiKey,
    fromAddress: row.emailFromAddress,
    fromName: row.emailFromName || "cashish",
  };
}

export type EmailAttachment = {
  filename: string;
  /** Raw bytes — each provider's own base64/Buffer requirement is handled here, not by the caller. */
  content: Buffer;
  contentType?: string;
};

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  /** Overrides platformSettings.emailFromName for this one send, e.g. the tenant's own business name. */
  fromName?: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
};

async function sendViaSendGrid(settings: PlatformEmailSettings, input: SendEmailInput) {
  sgMail.setApiKey(settings.apiKey);
  try {
    await sgMail.send({
      to: input.to,
      from: { email: settings.fromAddress, name: input.fromName ?? settings.fromName },
      subject: input.subject,
      html: input.html,
      replyTo: input.replyTo,
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content.toString("base64"),
        type: a.contentType,
        disposition: "attachment",
      })),
    });
  } catch (error) {
    const detail =
      error instanceof Error && "response" in error
        ? JSON.stringify((error as { response?: { body?: unknown } }).response?.body)
        : String(error);
    throw new Error(`Email send failed (SendGrid): ${detail}`);
  }
}

async function sendViaResend(settings: PlatformEmailSettings, input: SendEmailInput) {
  const resend = new Resend(settings.apiKey);
  const from = `${input.fromName ?? settings.fromName} <${settings.fromAddress}>`;
  const result = await resend.emails.send({
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    replyTo: input.replyTo,
    attachments: input.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
    })),
  });
  if (result.error) {
    throw new Error(`Email send failed (Resend): ${result.error.message}`);
  }
}

/**
 * Sends one email through whichever provider the platform is configured for.
 *
 * Throws if the platform isn't configured yet (an admin hasn't set an email
 * API key) — callers decide whether that's fatal to their flow or something
 * to catch and surface as "email not set up yet."
 */
export async function sendEmail(input: SendEmailInput) {
  const settings = await getPlatformEmailSettings();
  if (!settings) {
    throw new Error(
      "Email is not configured for this platform yet — set a provider, API key and " +
        "from-address in the admin console.",
    );
  }
  if (settings.provider === "resend") {
    await sendViaResend(settings, input);
  } else {
    await sendViaSendGrid(settings, input);
  }
}
