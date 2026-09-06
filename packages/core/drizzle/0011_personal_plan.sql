-- The personal plan.
--
-- Data, not schema: `plans.code` is a plain text primary key, so a new plan is
-- a row rather than a migration of the table. Generated from SEED_PLANS via
-- scripts/print-plan-seed.ts, exactly as the 0006 seed was, so the table and
-- the constant cannot drift.
--
-- ON CONFLICT DO NOTHING because the price is the admin console's to change:
-- re-running this must never quietly undo a decision made in the UI.
INSERT INTO "plans" ("code", "name", "price_cents", "cadence", "max_users", "features", "is_active", "sort_order") VALUES
  ('personal', 'Personal', 400, 'month', 2, '{"payroll":false,"receipts":true,"mcp":true,"oauth":false}', true, 10)
ON CONFLICT ("code") DO NOTHING;
