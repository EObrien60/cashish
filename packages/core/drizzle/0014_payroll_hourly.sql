ALTER TABLE "employees" ADD COLUMN "pay_basis" text DEFAULT 'salary' NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "hourly_rate" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "hours" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "hourly_rate" double precision DEFAULT 0 NOT NULL;