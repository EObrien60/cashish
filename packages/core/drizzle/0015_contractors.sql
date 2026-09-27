CREATE TABLE "contractors" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text DEFAULT '',
	"platform" text DEFAULT 'direct' NOT NULL,
	"platform_ref" text DEFAULT '',
	"default_rate" double precision DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timesheet_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"timesheet_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"amount" double precision NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timesheets" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"contractor_id" text NOT NULL,
	"period_start" text,
	"period_end" text NOT NULL,
	"hours" double precision DEFAULT 0 NOT NULL,
	"rate" double precision DEFAULT 0 NOT NULL,
	"amount" double precision DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_ref" text,
	"memo" text DEFAULT '',
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_payments" ADD CONSTRAINT "timesheet_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_payments" ADD CONSTRAINT "timesheet_payments_timesheet_id_timesheets_id_fk" FOREIGN KEY ("timesheet_id") REFERENCES "public"."timesheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_payments" ADD CONSTRAINT "tspay_tx_fk" FOREIGN KEY ("tenant_id","transaction_id") REFERENCES "public"."transactions"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contractor_tenant_idx" ON "contractors" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tspay_timesheet_idx" ON "timesheet_payments" USING btree ("tenant_id","timesheet_id");--> statement-breakpoint
CREATE INDEX "tspay_tx_idx" ON "timesheet_payments" USING btree ("tenant_id","transaction_id");--> statement-breakpoint
CREATE INDEX "timesheet_contractor_idx" ON "timesheets" USING btree ("tenant_id","contractor_id");--> statement-breakpoint
CREATE INDEX "timesheet_period_idx" ON "timesheets" USING btree ("tenant_id","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_external_ref_idx" ON "timesheets" USING btree ("tenant_id","external_ref") WHERE "timesheets"."external_ref" is not null;