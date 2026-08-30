ALTER TABLE "category_rules" ADD COLUMN "customer_id" text;--> statement-breakpoint
ALTER TABLE "category_rules" ADD COLUMN "posting" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "category_rules" ADD COLUMN "tax_kind" text;--> statement-breakpoint
ALTER TABLE "category_rules" ADD COLUMN "excluded_reason" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "customer_id" text;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tx_customer_idx" ON "transactions" USING btree ("tenant_id","customer_id");