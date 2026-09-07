CREATE TABLE "platform_settings" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"stripe_secret_key" text DEFAULT '',
	"stripe_webhook_secret" text DEFAULT '',
	"email_provider" text DEFAULT 'sendgrid' NOT NULL,
	"email_api_key" text DEFAULT '',
	"email_from_address" text DEFAULT '',
	"email_from_name" text DEFAULT 'cashish',
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "stripe_payment_link_url" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "stripe_secret_key" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "stripe_subscription_id" text;