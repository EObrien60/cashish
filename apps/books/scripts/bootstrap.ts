#!/usr/bin/env tsx
/**
 * Creates the first tenant and its owner. Run once against a fresh database.
 *
 *   DATABASE_URL=… npx tsx scripts/bootstrap.ts \
 *     --slug obh --name "OBH Software" --email ethan@triplebolt.io --password '…'
 *
 * Refuses to touch an existing tenant, so re-running by accident cannot reset
 * anybody's password.
 */
import { createTenant, findTenantBySlug } from "../src/db/seed";
import { createUser, findUserByEmail, addMembership, roleFor } from "../src/lib/auth";
import { pool } from "@cashish/core/db";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  if (i !== -1) return args[i + 1];
  return args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
};

async function main() {
  const slug = flag("slug");
  const name = flag("name");
  const email = flag("email");
  const password = flag("password") ?? process.env.BOOTSTRAP_PASSWORD;

  if (!slug || !name || !email || !password) {
    console.error(
      "usage: bootstrap.ts --slug <slug> --name <business name> --email <owner email> --password <password>\n" +
        "       (or set BOOTSTRAP_PASSWORD instead of --password, to keep it out of shell history)",
    );
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("choose a password of at least 12 characters.");
    process.exit(1);
  }

  if (await findTenantBySlug(slug)) {
    console.error(`tenant "${slug}" already exists — refusing to touch it.`);
    process.exit(1);
  }

  const tenantId = await createTenant({ slug, name });

  const existing = await findUserByEmail(email);
  const userId = existing?.id ?? (await createUser({ email, password }));
  if (existing) {
    console.log(`user ${email} already existed — password left unchanged, membership added.`);
  }
  await addMembership(userId, tenantId, "owner");

  console.log(`tenant  ${slug}  (${tenantId})`);
  console.log(`owner   ${email}  role=${await roleFor(userId, tenantId)}`);
  console.log(`\nSeeded 5 Irish VAT rates and 15 default categories.`);
  console.log(`Next: import the book with scripts/cloud-import.ts --tenant ${slug}`);

  await pool.end();
}

main().catch((error) => {
  console.error("bootstrap failed:", error);
  process.exit(1);
});
