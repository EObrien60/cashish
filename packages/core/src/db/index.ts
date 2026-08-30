/**
 * The database entry point both applications import.
 *
 * Re-exports rather than re-implements: `client.ts` remains the single point of
 * driver coupling and `context.ts` remains the single tenant gate. This file
 * exists so that consumers write `@cashish/core/db` instead of reaching into
 * the package's internal file layout, which would make that layout impossible
 * to change.
 */
export { db, pool, schema, first, type Db } from "./client";
export {
  runInTenant,
  ctx,
  tenantId,
  currentRole,
  maybeContext,
  type TenantContext,
} from "./context";
// Both forms, deliberately. `export *` is what lets a consumer write
// `import type { Payslip } from "@cashish/core/db"` for a row type, and the
// `tables` namespace is for code that wants the whole set under one name
// without shadowing the `schema` object `client.ts` already exports.
export * from "./schema";
export * as tables from "./schema";
