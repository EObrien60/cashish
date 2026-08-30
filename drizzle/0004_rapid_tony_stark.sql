CREATE TABLE "bill_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"bill_id" text NOT NULL,
	"date" text NOT NULL,
	"amount" double precision NOT NULL,
	"method" text DEFAULT 'bank',
	"transaction_id" text,
	"note" text DEFAULT '',
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"vendor_id" text NOT NULL,
	"number" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'awaiting' NOT NULL,
	"issue_date" text NOT NULL,
	"due_date" text,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"net" double precision DEFAULT 0 NOT NULL,
	"vat_total" double precision DEFAULT 0 NOT NULL,
	"total" double precision DEFAULT 0 NOT NULL,
	"amount_paid" double precision DEFAULT 0 NOT NULL,
	"category_id" text,
	"vat_rate_id" text,
	"notes" text DEFAULT '',
	"file_name" text DEFAULT '',
	"mime_type" text DEFAULT '',
	"file_size" integer DEFAULT 0 NOT NULL,
	"storage_path" text DEFAULT '',
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text DEFAULT '',
	"vat_number" text DEFAULT '',
	"address_line1" text DEFAULT '',
	"address_line2" text DEFAULT '',
	"city" text DEFAULT '',
	"country" text DEFAULT 'Ireland',
	"default_category_id" text,
	"notes" text DEFAULT '',
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "category_rules" ADD COLUMN "vendor_id" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "vendor_id" text;--> statement-breakpoint
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payments" ADD CONSTRAINT "billpay_tx_fk" FOREIGN KEY ("tenant_id","transaction_id") REFERENCES "public"."transactions"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_vat_rate_id_vat_rates_id_fk" FOREIGN KEY ("vat_rate_id") REFERENCES "public"."vat_rates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_default_category_id_categories_id_fk" FOREIGN KEY ("default_category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billpay_bill_idx" ON "bill_payments" USING btree ("tenant_id","bill_id");--> statement-breakpoint
CREATE INDEX "billpay_date_idx" ON "bill_payments" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "bill_vendor_idx" ON "bills" USING btree ("tenant_id","vendor_id");--> statement-breakpoint
CREATE INDEX "bill_status_idx" ON "bills" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "bill_due_idx" ON "bills" USING btree ("tenant_id","due_date");--> statement-breakpoint
CREATE INDEX "vendor_tenant_idx" ON "vendors" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tx_vendor_idx" ON "transactions" USING btree ("tenant_id","vendor_id");