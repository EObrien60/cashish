// ---------------------------------------------------------------------------
// The one place the permission policy lives.
//
// Roles are checked through `can()` / `requireCapability()` and nowhere else —
// no scattered `if (role === "owner")`. The UI, the server actions, the REST
// routes and the MCP tools all consult this same map, which is what makes
// "a viewer API key cannot write" true by construction rather than by review.
// ---------------------------------------------------------------------------

export const ROLES = ["owner", "accountant", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const CAPABILITIES = [
  /** Read the books: transactions, invoices, reports, VAT, reconciliation. */
  "books:read",
  /** Write the books: transactions, rules, invoices, payments, customers, products. */
  "books:write",
  /** Import bank statements and RPN files. */
  "books:import",
  /** Business settings (name, VAT number, invoice numbering, logo). */
  "settings:write",
  /** Users, invites, API keys, OAuth clients. */
  "tenant:admin",
  /** Delete the tenant and everything in it. */
  "tenant:delete",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

const POLICY: Record<Role, readonly Capability[]> = {
  owner: ["books:read", "books:write", "books:import", "settings:write", "tenant:admin", "tenant:delete"],
  accountant: ["books:read", "books:write", "books:import"],
  viewer: ["books:read"],
};

export function can(role: Role, capability: Capability): boolean {
  return POLICY[role].includes(capability);
}

export class ForbiddenError extends Error {
  readonly capability: Capability;
  readonly role: Role;
  constructor(role: Role, capability: Capability) {
    super(`role "${role}" lacks capability "${capability}"`);
    this.name = "ForbiddenError";
    this.role = role;
    this.capability = capability;
  }
}

export function requireCapability(role: Role, capability: Capability): void {
  if (!can(role, capability)) throw new ForbiddenError(role, capability);
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** OAuth scopes map onto capabilities; a token can never exceed its user's role. */
export const SCOPES = ["books:read", "books:write"] as const;
export type Scope = (typeof SCOPES)[number];

export function scopesForRole(role: Role): Scope[] {
  return SCOPES.filter((s) => can(role, s as Capability));
}
