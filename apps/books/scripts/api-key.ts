#!/usr/bin/env tsx
/**
 * Mint or revoke an API key from the command line.
 *
 *   npx tsx scripts/api-key.ts --tenant obh --name "claude code" --role owner
 *   npx tsx scripts/api-key.ts --tenant obh --list
 *   npx tsx scripts/api-key.ts --tenant obh --revoke <id>
 *
 * The key is printed once. Only its hash is stored, so there is no way to
 * recover it later — mint a new one and revoke the old.
 */
import { findTenantBySlug } from "../src/db/seed";
import { createApiKey, listApiKeys, revokeApiKey } from "../src/lib/auth";
import { isRole } from "@cashish/core/rbac";
import { pool } from "@cashish/core/db";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  if (i !== -1) return args[i + 1];
  return args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
};
const has = (name: string) => args.includes(`--${name}`);

async function main() {
  const slug = flag("tenant");
  if (!slug) {
    console.error("usage: api-key.ts --tenant <slug> [--name <label> --role <role> | --list | --revoke <id>]");
    process.exit(1);
  }
  const tenant = await findTenantBySlug(slug);
  if (!tenant) {
    console.error(`no tenant with slug "${slug}".`);
    process.exit(1);
  }

  if (has("list")) {
    const keys = await listApiKeys(tenant.id);
    if (keys.length === 0) console.log("no keys");
    for (const k of keys) {
      const state = k.revokedAt ? `revoked ${k.revokedAt}` : `last used ${k.lastUsedAt ?? "never"}`;
      console.log(`${k.id}  ${k.role.padEnd(10)} ${k.name.padEnd(24)} ${state}`);
    }
    return;
  }

  const revoke = flag("revoke");
  if (revoke) {
    await revokeApiKey(tenant.id, revoke);
    console.log(`revoked ${revoke}`);
    return;
  }

  const role = flag("role") ?? "viewer";
  if (!isRole(role)) {
    console.error("--role must be owner, accountant or viewer");
    process.exit(1);
  }
  const { id, key } = await createApiKey({
    tenantId: tenant.id,
    name: flag("name") ?? "Untitled key",
    role,
    createdBy: null,
  });
  console.log(`id   ${id}`);
  console.log(`role ${role}`);
  console.log(`key  ${key}`);
  console.log("\nThis is the only time the key is shown.");
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error("failed:", error);
    await pool.end().catch(() => {});
    process.exit(1);
  });
