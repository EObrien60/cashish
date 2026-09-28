ALTER TABLE "documents" ADD COLUMN "sha256" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "document_sha256_idx" ON "documents" USING btree ("tenant_id","sha256");