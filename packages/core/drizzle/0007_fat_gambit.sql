CREATE TABLE "admin_login_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"attempted_at" text DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE INDEX "login_attempt_idx" ON "admin_login_attempts" USING btree ("identifier","attempted_at");