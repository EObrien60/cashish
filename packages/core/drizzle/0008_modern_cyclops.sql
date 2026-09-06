CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'current' NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"external_ref" text DEFAULT '',
	"inferred" boolean DEFAULT false NOT NULL,
	"opening_balance" double precision DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "account_id" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "transfer_account_id" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "transfer_peer_id" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_tenant_idx" ON "accounts" USING btree ("tenant_id","archived");--> statement-breakpoint
CREATE UNIQUE INDEX "account_name_idx" ON "accounts" USING btree ("tenant_id","name");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_account_id_accounts_id_fk" FOREIGN KEY ("transfer_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tx_account_idx" ON "transactions" USING btree ("tenant_id","account_id");