#!/usr/bin/env tsx
/**
 * Creates a platform administrator.
 *
 * The only way one comes into existence. The console has no registration route
 * and never will: a tool that can suspend a business and rewrite what it pays
 * should not have a sign-up form reachable from the internet.
 *
 *   npm run admin:create -- --email you@example.com --password '…' --name 'Ethan'
 */
import { createAdmin, MIN_PASSWORD_LENGTH } from "../src/lib/admin-auth";
import { pool } from "@cashish/core/db";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const email = arg("email");
  const password = arg("password");
  const name = arg("name") ?? "";

  if (!email || !password) {
    console.error(
      "usage: npm run admin:create -- --email <address> --password <password> [--name <name>]",
    );
    process.exit(1);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exit(1);
  }

  const id = await createAdmin({ email, password, name });
  console.log(`created platform administrator ${email}`);
  console.log(`id: ${id}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
