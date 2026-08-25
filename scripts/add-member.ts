#!/usr/bin/env tsx
/**
 * Gives someone access to a tenant, without going through an invite link.
 *
 *   npx tsx scripts/add-member.ts --tenant obh --email them@example.com --role accountant
 *   npx tsx scripts/add-member.ts --tenant obh --email them@example.com --role viewer \
 *     --password 'a-temporary-passphrase'      # only if they have no account yet
 *   npx tsx scripts/add-member.ts --tenant obh --list
 *   npx tsx scripts/add-member.ts --tenant obh --email them@example.com --remove
 *
 * The invite flow in Settings → People is the normal route, because it lets the
 * person choose their own password. This is for the cases that flow cannot
 * reach: seeding, or an account that already exists.
 */
import { and, eq } from "drizzle-orm";
import { db, pool, schema } from "../src/db/client";
import { findTenantBySlug } from "../src/db/seed";
import { createUser, findUserByEmail, addMembership, membershipsFor } from "../src/lib/auth";
import { isRole } from "../src/lib/rbac";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  if (i !== -1) return args[i + 1];
  return args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
};
const has = (name: string) => args.includes(`--${name}`);

async function main() {
  const slug = flag("tenant");
  if (!slug) {
    console.error("usage: add-member.ts --tenant <slug> [--email … --role … | --list | --email … --remove]");
    process.exit(1);
  }
  const tenant = await findTenantBySlug(slug);
  if (!tenant) {
    console.error(`no tenant with slug "${slug}".`);
    process.exit(1);
  }

  if (has("list")) {
    const rows = await db
      .select({ email: schema.users.email, role: schema.memberships.role })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
      .where(eq(schema.memberships.tenantId, tenant.id));
    if (rows.length === 0) console.log("no members");
    for (const r of rows) console.log(`${r.role.padEnd(11)} ${r.email}`);
    return;
  }

  const email = flag("email");
  if (!email) {
    console.error("--email is required");
    process.exit(1);
  }

  if (has("remove")) {
    const user = await findUserByEmail(email);
    if (!user) {
      console.error(`no user with email ${email}`);
      process.exit(1);
    }
    // Never leave a tenant with no owner — it would become unadministrable.
    const owners = await db
      .select({ userId: schema.memberships.userId })
      .from(schema.memberships)
      .where(
        and(eq(schema.memberships.tenantId, tenant.id), eq(schema.memberships.role, "owner")),
      );
    if (owners.length === 1 && owners[0].userId === user.id) {
      console.error(`${email} is the only owner of ${slug} — promote someone else first.`);
      process.exit(1);
    }
    await db
      .delete(schema.memberships)
      .where(
        and(eq(schema.memberships.tenantId, tenant.id), eq(schema.memberships.userId, user.id)),
      );
    console.log(`removed ${email} from ${slug}`);
    return;
  }

  const role = flag("role") ?? "viewer";
  if (!isRole(role)) {
    console.error("--role must be owner, accountant or viewer");
    process.exit(1);
  }

  let user = await findUserByEmail(email);
  if (!user) {
    const password = flag("password") ?? process.env.MEMBER_PASSWORD;
    if (!password || password.length < 12) {
      console.error(
        `no account for ${email}. Either send them an invite from Settings → People ` +
          "(so they pick their own password), or pass --password with at least 12 characters.",
      );
      process.exit(1);
    }
    await createUser({ email, password });
    user = await findUserByEmail(email);
    console.log(`created account for ${email}`);
  }

  await addMembership(user!.id, tenant.id, role);
  const now = await membershipsFor(user!.id);
  console.log(`${email} is now ${role} of ${slug}`);
  console.log(`  their businesses: ${now.map((m) => `${m.slug}(${m.role})`).join(", ")}`);
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error("failed:", e);
    await pool.end().catch(() => {});
    process.exit(1);
  });
