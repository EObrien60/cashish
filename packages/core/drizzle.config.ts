import type { Config } from "drizzle-kit";

// Postgres everywhere — Neon in production, a plain container in dev and test.
// One dialect means the schema, the migrations and the tests all exercise the
// same engine the books actually live on.
export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
} satisfies Config;
