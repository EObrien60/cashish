CREATE TABLE "contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"name" text NOT NULL,
	"reference" text DEFAULT '',
	"status" text DEFAULT 'active' NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text,
	"value" double precision,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"terms" text DEFAULT '',
	"notes" text DEFAULT '',
	"document_path" text DEFAULT '',
	"document_name" text DEFAULT '',
	"document_mime" text DEFAULT '',
	"document_size" integer DEFAULT 0 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "contract_id" text;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN "contract_id" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_customer_idx" ON "contracts" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "contract_status_idx" ON "contracts" USING btree ("tenant_id","status");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inv_contract_idx" ON "invoices" USING btree ("tenant_id","contract_id");