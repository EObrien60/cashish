import Stripe from "stripe";
import { db, schema, first } from "./db/client";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Two entirely separate Stripe relationships, never to be confused:
//
//   - A TENANT's own key (`settings.stripeSecretKey`) pays THEM, for THEIR
//     invoices. cashish never touches that money.
//   - The PLATFORM's key (`platformSettings.stripeSecretKey`) pays cashish
//     itself, for a tenant's subscription. This is OBH's own Stripe account.
//
// Lazy, like everything in @cashish/core/db: constructing a client must never
// happen at module load, or `next build` — which imports every route to
// collect its config — starts needing live credentials to build at all.
// ---------------------------------------------------------------------------

const { platformSettings } = schema;

function stripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, { apiVersion: "2025-08-27.basil" as Stripe.LatestApiVersion });
}

export type PaymentLinkInput = {
  /** Major units, e.g. 1250.50 for €1,250.50 — converted to the minor unit Stripe expects. */
  amount: number;
  currency: string;
  description: string;
};

/**
 * Creates a one-off Stripe Payment Link against a TENANT's own key. Money
 * lands directly in their Stripe account; cashish only ever holds the link.
 *
 * No pre-created Product/Price — `price_data` is inline because every invoice
 * amount is one-off, and pre-creating a Price per invoice would just be
 * Stripe objects nobody ever looks at again.
 */
export async function createTenantPaymentLink(
  secretKey: string,
  { amount, currency, description }: PaymentLinkInput,
): Promise<string> {
  const stripe = stripeClient(secretKey);
  // Payment Links need a real Price object, unlike Checkout Sessions (which
  // take price_data inline) — create one, one-off, for this invoice amount.
  const price = await stripe.prices.create({
    currency: currency.toLowerCase(),
    unit_amount: Math.round(amount * 100),
    product_data: { name: description },
  });
  const link = await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
  });
  return link.url;
}

/** Reads the platform's own Stripe config. Returns null if not configured yet. */
export async function getPlatformStripeSettings(): Promise<
  { secretKey: string; webhookSecret: string } | null
> {
  const row = first(
    await db.select().from(platformSettings).where(eq(platformSettings.id, "singleton")).limit(1),
  );
  if (!row?.stripeSecretKey) return null;
  return { secretKey: row.stripeSecretKey, webhookSecret: row.stripeWebhookSecret ?? "" };
}

/** The platform's own Stripe client — for billing tenants' subscriptions, not their invoices. */
export async function platformStripeClient(): Promise<Stripe | null> {
  const settings = await getPlatformStripeSettings();
  if (!settings) return null;
  return stripeClient(settings.secretKey);
}

export type ShopCheckoutInput = {
  /** Gross unit price (incl. VAT), major units. */
  unitAmount: number;
  currency: string;
  name: string;
  description?: string;
  /** Flat shipping for the order, major units. 0 = free. */
  shipping: number;
  /** Only goods need an address; a service sold in the shop does not. */
  collectAddress: boolean;
  successUrl: string;
  cancelUrl: string;
};

// ponytail: EU27 + GB only. Widen (or make it a setting) when a tenant ships further.
const SHIP_TO = [
  "IE", "GB", "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
] as const;

/**
 * A Checkout Session for one quickshop product, on the TENANT's own key.
 * Checkout Sessions rather than Payment Links: price and shipping go inline, so
 * nothing is pre-created in the tenant's Stripe account per product.
 */
export async function createTenantShopCheckout(
  secretKey: string,
  input: ShopCheckoutInput,
): Promise<string> {
  const stripe = stripeClient(secretKey);
  const currency = input.currency.toLowerCase();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency,
          unit_amount: Math.round(input.unitAmount * 100),
          product_data: {
            name: input.name,
            ...(input.description ? { description: input.description } : {}),
          },
        },
        quantity: 1,
        adjustable_quantity: { enabled: true, minimum: 1, maximum: 99 },
      },
    ],
    ...(input.collectAddress
      ? {
          shipping_address_collection: { allowed_countries: [...SHIP_TO] },
          shipping_options: [
            {
              shipping_rate_data: {
                type: "fixed_amount" as const,
                display_name: input.shipping > 0 ? "Shipping" : "Free shipping",
                fixed_amount: { amount: Math.round(input.shipping * 100), currency },
              },
            },
          ],
        }
      : {}),
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return session.url;
}
