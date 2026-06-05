import type { Config } from "drizzle-kit";

// SQLite today; the schema and query layer are written to be portable so a
// future swap to Postgres/MySQL means changing this dialect + the client in
// src/db/client.ts, not the app code.
export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "./cashish.db",
  },
} satisfies Config;
