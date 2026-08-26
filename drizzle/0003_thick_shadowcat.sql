ALTER TABLE "categories" ADD COLUMN "cost_of_sales" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Existing tenants were seeded before this column existed; flag their
-- already-created "Cost of sales" category so margins work without re-seeding.
UPDATE "categories" SET "cost_of_sales" = true WHERE "id" LIKE '%:cat-cogs';
