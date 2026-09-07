import { eq } from "drizzle-orm";
import { db, first, schema } from "@cashish/core/db";

const { platformSettings } = schema;

/**
 * The one row. Returns sensible empty defaults if it doesn't exist yet —
 * callers never have to handle "no settings row" as a separate case.
 */
export async function getPlatformSettings() {
  const row = first(
    await db.select().from(platformSettings).where(eq(platformSettings.id, "singleton")).limit(1),
  );
  return (
    row ?? {
      id: "singleton" as const,
      stripeSecretKey: "",
      stripeWebhookSecret: "",
      emailProvider: "resend",
      emailApiKey: "",
      emailFromAddress: "",
      emailFromName: "cashish",
      updatedAt: "",
    }
  );
}
