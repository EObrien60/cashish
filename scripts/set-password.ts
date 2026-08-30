#!/usr/bin/env tsx
/**
 * Sets a user's password. For rotating the bootstrap password, or a reset.
 *
 *   npx tsx scripts/set-password.ts --email you@example.com --password '…'
 *   BOOTSTRAP_PASSWORD='…' npx tsx scripts/set-password.ts --email you@example.com
 */
import { findUserByEmail, setUserPassword } from "../src/lib/auth";
import { pool } from "../src/db/client";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  if (i !== -1) return args[i + 1];
  return args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
};

async function main() {
  const email = flag("email");
  const password = flag("password") ?? process.env.BOOTSTRAP_PASSWORD;
  if (!email || !password) {
    console.error("usage: set-password.ts --email <email> --password <password>");
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("choose a password of at least 12 characters.");
    process.exit(1);
  }
  const user = await findUserByEmail(email);
  if (!user) {
    console.error(`no user with email ${email}`);
    process.exit(1);
  }
  await setUserPassword(user.id, password);
  console.log(`password updated for ${email}`);
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error("failed:", e);
    await pool.end().catch(() => {});
    process.exit(1);
  });
