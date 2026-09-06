CREATE TABLE "budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"category_id" text NOT NULL,
	"month" text NOT NULL,
	"amount" double precision DEFAULT 0 NOT NULL,
	"note" text DEFAULT '',
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "kind" text DEFAULT 'business' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "region" text DEFAULT 'IE' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "currency" text DEFAULT 'EUR' NOT NULL;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_month_idx" ON "budgets" USING btree ("tenant_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_cat_month_idx" ON "budgets" USING btree ("tenant_id","category_id","month");