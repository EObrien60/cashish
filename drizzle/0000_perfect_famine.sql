CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"default_vat_rate_id" text,
	"vat_applicable" boolean DEFAULT true NOT NULL,
	"color" text DEFAULT '#9ca3af',
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text DEFAULT '',
	"match_field" text DEFAULT 'description' NOT NULL,
	"match_type" text DEFAULT 'contains' NOT NULL,
	"match_value" text DEFAULT '' NOT NULL,
	"direction" text DEFAULT 'any' NOT NULL,
	"category_id" text,
	"vat_rate_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"times_applied" integer DEFAULT 0 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text DEFAULT '',
	"vat_number" text DEFAULT '',
	"address_line1" text DEFAULT '',
	"address_line2" text DEFAULT '',
	"city" text DEFAULT '',
	"country" text DEFAULT 'Ireland',
	"notes" text DEFAULT '',
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"first_name" text DEFAULT '' NOT NULL,
	"family_name" text DEFAULT '' NOT NULL,
	"ppsn" text DEFAULT '',
	"employer_reference" text DEFAULT '',
	"employment_id" text DEFAULT '1' NOT NULL,
	"dob" text,
	"address_line1" text DEFAULT '',
	"address_line2" text DEFAULT '',
	"city" text DEFAULT '',
	"email" text DEFAULT '',
	"start_date" text,
	"date_of_leaving" text,
	"director" text DEFAULT '',
	"pay_frequency" text DEFAULT 'Monthly' NOT NULL,
	"standard_gross" double precision DEFAULT 0 NOT NULL,
	"pension_employee_pct" double precision DEFAULT 0 NOT NULL,
	"prsi_class" text DEFAULT 'A',
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"product_id" text,
	"description" text DEFAULT '' NOT NULL,
	"quantity" double precision DEFAULT 1 NOT NULL,
	"unit_price" double precision DEFAULT 0 NOT NULL,
	"vat_rate_id" text,
	"vat_rate" double precision DEFAULT 0 NOT NULL,
	"line_net" double precision DEFAULT 0 NOT NULL,
	"line_vat" double precision DEFAULT 0 NOT NULL,
	"line_total" double precision DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"number" text NOT NULL,
	"customer_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"issue_date" text NOT NULL,
	"due_date" text,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"notes" text DEFAULT '',
	"terms" text DEFAULT '',
	"subtotal" double precision DEFAULT 0 NOT NULL,
	"vat_total" double precision DEFAULT 0 NOT NULL,
	"total" double precision DEFAULT 0 NOT NULL,
	"amount_paid" double precision DEFAULT 0 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"tax_year" integer NOT NULL,
	"period_no" integer NOT NULL,
	"pay_date" text NOT NULL,
	"frequency" text DEFAULT 'Monthly' NOT NULL,
	"payroll_run_reference" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"date" text NOT NULL,
	"amount" double precision NOT NULL,
	"method" text DEFAULT 'bank',
	"transaction_id" text,
	"note" text DEFAULT '',
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"pay_run_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"rpn_number" text DEFAULT '',
	"income_tax_basis" text DEFAULT 'Cumulative',
	"exclusion_order" boolean DEFAULT false NOT NULL,
	"tax_credits_this_period" double precision DEFAULT 0,
	"standard_rate_cutoff" double precision DEFAULT 0,
	"gross_pay" double precision DEFAULT 0 NOT NULL,
	"pension_employee" double precision DEFAULT 0 NOT NULL,
	"pension_employer" double precision DEFAULT 0 NOT NULL,
	"pay_for_income_tax" double precision DEFAULT 0 NOT NULL,
	"income_tax_paid" double precision DEFAULT 0 NOT NULL,
	"pay_for_employee_prsi" double precision DEFAULT 0 NOT NULL,
	"pay_for_employer_prsi" double precision DEFAULT 0 NOT NULL,
	"employee_prsi" double precision DEFAULT 0 NOT NULL,
	"employer_prsi" double precision DEFAULT 0 NOT NULL,
	"prsi_class" text DEFAULT 'A',
	"insurable_weeks" integer DEFAULT 4 NOT NULL,
	"prsi_exempt" boolean DEFAULT false NOT NULL,
	"pay_for_usc" double precision DEFAULT 0 NOT NULL,
	"usc_status" text DEFAULT 'Ordinary',
	"usc_paid" double precision DEFAULT 0 NOT NULL,
	"lpt_deducted" double precision DEFAULT 0 NOT NULL,
	"other_deductions" double precision DEFAULT 0 NOT NULL,
	"other_deductions_label" text DEFAULT '',
	"net_pay" double precision DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '',
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '',
	"unit_price" double precision DEFAULT 0 NOT NULL,
	"vat_rate_id" text,
	"kind" text DEFAULT 'service' NOT NULL,
	"income_category_id" text,
	"sku" text DEFAULT '',
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text DEFAULT 'application/octet-stream' NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"storage_path" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_invoice_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"recurring_id" text NOT NULL,
	"product_id" text,
	"description" text DEFAULT '' NOT NULL,
	"quantity" double precision DEFAULT 1 NOT NULL,
	"unit_price" double precision DEFAULT 0 NOT NULL,
	"vat_rate_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"customer_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"frequency" text DEFAULT 'monthly' NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"start_date" text NOT NULL,
	"next_run_date" text NOT NULL,
	"end_date" text,
	"occurrences_limit" integer,
	"occurrences_count" integer DEFAULT 0 NOT NULL,
	"due_days" integer DEFAULT 30 NOT NULL,
	"auto_send" boolean DEFAULT false NOT NULL,
	"notes" text DEFAULT '',
	"terms" text DEFAULT '',
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rpns" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"employee_id" text,
	"tax_year" integer NOT NULL,
	"rpn_number" text DEFAULT '' NOT NULL,
	"rpn_issue_date" text,
	"first_name" text DEFAULT '',
	"family_name" text DEFAULT '',
	"ppsn" text DEFAULT '',
	"employment_id" text DEFAULT '',
	"employer_reference" text DEFAULT '',
	"income_tax_basis" text DEFAULT 'Cumulative',
	"exclusion_order" boolean DEFAULT false NOT NULL,
	"effective_date" text,
	"end_date" text,
	"pay_for_income_tax_to_date" double precision DEFAULT 0,
	"income_tax_deducted_to_date" double precision DEFAULT 0,
	"yearly_tax_credit" double precision DEFAULT 0,
	"tax_rate1_pct" double precision DEFAULT 0.2,
	"yearly_rate1_cutoff" double precision DEFAULT 0,
	"tax_rate2_pct" double precision DEFAULT 0.4,
	"prsi_exempt" boolean DEFAULT false NOT NULL,
	"prsi_class" text DEFAULT '',
	"usc_status" text DEFAULT 'Ordinary',
	"usc_bands" text DEFAULT '[]',
	"pay_for_usc_to_date" double precision DEFAULT 0,
	"usc_deducted_to_date" double precision DEFAULT 0,
	"lpt_to_deduct" double precision DEFAULT 0,
	"employment_cessation_date" text,
	"state_pension_contributory" boolean DEFAULT false NOT NULL,
	"raw_json" text DEFAULT '',
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"business_name" text DEFAULT 'My Business' NOT NULL,
	"address_line1" text DEFAULT '',
	"address_line2" text DEFAULT '',
	"city" text DEFAULT '',
	"country" text DEFAULT 'Ireland',
	"vat_number" text DEFAULT '',
	"email" text DEFAULT '',
	"phone" text DEFAULT '',
	"iban" text DEFAULT '',
	"bic" text DEFAULT '',
	"invoice_prefix" text DEFAULT 'INV-' NOT NULL,
	"next_invoice_seq" integer DEFAULT 1 NOT NULL,
	"invoice_footer" text DEFAULT 'Thank you for your business.',
	"vat_basis" text DEFAULT 'cash' NOT NULL,
	"logo_data_url" text DEFAULT '',
	"employer_reg_number" text DEFAULT ''
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"date_started" text,
	"date_completed" text,
	"booked_date" text NOT NULL,
	"type" text,
	"state" text,
	"description" text DEFAULT '',
	"reference" text DEFAULT '',
	"payer" text DEFAULT '',
	"card_label" text DEFAULT '',
	"orig_currency" text DEFAULT '',
	"orig_amount" double precision,
	"currency" text DEFAULT 'EUR',
	"amount" double precision NOT NULL,
	"fee" double precision DEFAULT 0,
	"balance" double precision,
	"account" text DEFAULT '',
	"mcc" text DEFAULT '',
	"category_id" text,
	"vat_rate_id" text,
	"note" text DEFAULT '',
	"reconciled" boolean DEFAULT false NOT NULL,
	"excluded" boolean DEFAULT false NOT NULL,
	"excluded_reason" text DEFAULT '',
	"import_batch" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "transactions_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "vat_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"rate" double precision NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"exempt" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_default_vat_rate_id_vat_rates_id_fk" FOREIGN KEY ("default_vat_rate_id") REFERENCES "public"."vat_rates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_vat_rate_id_vat_rates_id_fk" FOREIGN KEY ("vat_rate_id") REFERENCES "public"."vat_rates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_vat_rate_id_vat_rates_id_fk" FOREIGN KEY ("vat_rate_id") REFERENCES "public"."vat_rates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_runs" ADD CONSTRAINT "pay_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "pay_tx_fk" FOREIGN KEY ("tenant_id","transaction_id") REFERENCES "public"."transactions"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_pay_run_id_pay_runs_id_fk" FOREIGN KEY ("pay_run_id") REFERENCES "public"."pay_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_vat_rate_id_vat_rates_id_fk" FOREIGN KEY ("vat_rate_id") REFERENCES "public"."vat_rates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_income_category_id_categories_id_fk" FOREIGN KEY ("income_category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipt_tx_fk" FOREIGN KEY ("tenant_id","transaction_id") REFERENCES "public"."transactions"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoice_lines" ADD CONSTRAINT "recurring_invoice_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoice_lines" ADD CONSTRAINT "recurring_invoice_lines_recurring_id_recurring_invoices_id_fk" FOREIGN KEY ("recurring_id") REFERENCES "public"."recurring_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoice_lines" ADD CONSTRAINT "recurring_invoice_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoice_lines" ADD CONSTRAINT "recurring_invoice_lines_vat_rate_id_vat_rates_id_fk" FOREIGN KEY ("vat_rate_id") REFERENCES "public"."vat_rates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rpns" ADD CONSTRAINT "rpns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rpns" ADD CONSTRAINT "rpns_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_vat_rate_id_vat_rates_id_fk" FOREIGN KEY ("vat_rate_id") REFERENCES "public"."vat_rates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_rates" ADD CONSTRAINT "vat_rates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cat_tenant_idx" ON "categories" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "rule_order_idx" ON "category_rules" USING btree ("tenant_id","sort_order");--> statement-breakpoint
CREATE INDEX "cust_tenant_idx" ON "customers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "emp_ppsn_idx" ON "employees" USING btree ("tenant_id","ppsn");--> statement-breakpoint
CREATE INDEX "line_inv_idx" ON "invoice_lines" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "inv_cust_idx" ON "invoices" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "inv_status_idx" ON "invoices" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_number_idx" ON "invoices" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "run_tenant_idx" ON "pay_runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "pay_inv_idx" ON "payments" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "pay_date_idx" ON "payments" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "slip_run_idx" ON "payslips" USING btree ("tenant_id","pay_run_id");--> statement-breakpoint
CREATE INDEX "slip_emp_idx" ON "payslips" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "prod_tenant_idx" ON "products" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "receipt_tx_idx" ON "receipts" USING btree ("tenant_id","transaction_id");--> statement-breakpoint
CREATE INDEX "recline_rec_idx" ON "recurring_invoice_lines" USING btree ("tenant_id","recurring_id");--> statement-breakpoint
CREATE INDEX "rec_next_idx" ON "recurring_invoices" USING btree ("tenant_id","next_run_date");--> statement-breakpoint
CREATE INDEX "rec_cust_idx" ON "recurring_invoices" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "rpn_emp_idx" ON "rpns" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "rpn_year_idx" ON "rpns" USING btree ("tenant_id","tax_year");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_slug_idx" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "tx_booked_idx" ON "transactions" USING btree ("tenant_id","booked_date");--> statement-breakpoint
CREATE INDEX "tx_cat_idx" ON "transactions" USING btree ("tenant_id","category_id");--> statement-breakpoint
CREATE INDEX "tx_excluded_idx" ON "transactions" USING btree ("tenant_id","excluded");--> statement-breakpoint
CREATE INDEX "vat_tenant_idx" ON "vat_rates" USING btree ("tenant_id");