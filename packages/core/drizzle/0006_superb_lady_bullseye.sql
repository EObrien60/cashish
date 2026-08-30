CREATE TABLE "admin_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_id" text NOT NULL,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"tenant_id" text,
	"before" text,
	"after" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"price_cents" integer,
	"cadence" text DEFAULT 'month' NOT NULL,
	"max_users" integer,
	"features" text DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"disabled_at" text,
	"last_login_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"plan_code" text NOT NULL,
	"status" text NOT NULL,
	"trial_ends_at" text,
	"current_period_end" text,
	"cancelled_at" text,
	"note" text DEFAULT '' NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disabled_at" text;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_admin_id_platform_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."platform_admins"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_code_plans_code_fk" FOREIGN KEY ("plan_code") REFERENCES "public"."plans"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_admin_idx" ON "admin_audit_log" USING btree ("admin_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_subject_idx" ON "admin_audit_log" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_admin_email_idx" ON "platform_admins" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_tenant_idx" ON "subscriptions" USING btree ("tenant_id");--> statement-breakpoint
-- The three plans. The table is the source of truth, because changing a price
-- or a limit is an operational act the admin console exists to perform rather
-- than a deploy. Generated from SEED_PLANS via scripts/print-plan-seed.ts, so
-- the two cannot drift.
INSERT INTO "plans" ("code", "name", "price_cents", "cadence", "max_users", "features", "is_active", "sort_order") VALUES
  ('sole', 'Sole trader', 900, 'month', 1, '{"payroll":false,"receipts":false,"mcp":false,"oauth":false}', true, 0),
  ('company', 'Company', 2900, 'month', NULL, '{"payroll":true,"receipts":true,"mcp":true,"oauth":false}', true, 1),
  ('practice', 'Practice', NULL, 'month', NULL, '{"payroll":true,"receipts":true,"mcp":true,"oauth":true}', true, 2)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
-- Backfill. Every tenant that already exists gets a subscription, so the console
-- opens on a complete picture rather than a list of tenants in an unknown state,
-- and nobody using cashish today loses anything when limits arrive.
INSERT INTO "subscriptions" ("id", "tenant_id", "plan_code", "status", "note")
SELECT gen_random_uuid()::text, t."id", 'company', 'active', 'granted by the 0006 backfill'
FROM "tenants" t
WHERE NOT EXISTS (SELECT 1 FROM "subscriptions" s WHERE s."tenant_id" = t."id");
