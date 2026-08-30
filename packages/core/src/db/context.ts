import { AsyncLocalStorage } from "node:async_hooks";
import type { Role } from "../rbac";

// ---------------------------------------------------------------------------
// Tenant context.
//
// Every query in src/lib/* is scoped to one tenant. Threading a tenant argument
// through ~100 functions would be a large, easy-to-get-wrong diff, so the
// tenant travels in AsyncLocalStorage instead and the query layer reads it.
//
// This requires the Node runtime (not Edge), which is the Vercel default.
//
// Isolation is enforced here and in src/lib/* — there is no Postgres RLS behind
// it. The deliberate consequence: `ctx()` THROWS when there is no context, so a
// query attempted outside a tenant fails loudly instead of quietly reading
// every book in the database. Never make this return a default.
// ---------------------------------------------------------------------------

export type TenantContext = {
  tenantId: string;
  role: Role;
  /** Who is acting: "user:<id>", "apikey:<id>", or "oauth:<tokenId>". For audit. */
  actor: string;
};

const store = new AsyncLocalStorage<TenantContext>();

export function runInTenant<T>(context: TenantContext, fn: () => Promise<T>): Promise<T> {
  return store.run(context, fn);
}

export function ctx(): TenantContext {
  const current = store.getStore();
  if (!current) {
    throw new Error(
      "No tenant context: a database query was attempted outside runInTenant(). " +
        "Every entry point (page, server action, API route, MCP call, CLI script) " +
        "must establish the tenant before touching src/lib/*.",
    );
  }
  return current;
}

/** The scoping value every query in src/lib/* filters on. */
export function tenantId(): string {
  return ctx().tenantId;
}

export function currentRole(): Role {
  return ctx().role;
}

/** Present without throwing — for code that legitimately runs both ways. */
export function maybeContext(): TenantContext | undefined {
  return store.getStore();
}
