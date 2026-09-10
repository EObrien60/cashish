# Admin management API

Node-runtime routes under `/api/management` in apps/admin. `Authorization: Bearer <SAAS_GOD_TOKEN>` is mandatory. Set a random token of at least 32 characters and `SAAS_ADMIN_ID` to an existing active platform administrator. Its disabled state is checked per request; no customer identity can substitute.

- GET /tenants, /tenants/:id, /plans, /subscriptions, /audit. Tenant detail excludes OAuth token hashes and contains support metadata, never ledger rows.
- PATCH /tenants/:id/status with exactly `{ "status": "active" }` or `{ "status": "suspended" }`. Requires an existing subscription. The update and administrator audit entry commit in one transaction with a row lock.

Machine routes are exempt from the cookie-presence redirect only; the handler authenticates both token and administrator. Secrets remain server-side. Rotation requires updating the service environment and local dashboard configuration, then redeploying/restarting.

Tests: apps/admin/tests/management-api.test.ts plus the existing authentication, audit, query and boundary suites, against isolated Postgres.
