import { db } from "@/db/client";

// Importing the client creates the connection, applies schema and seeds on
// first use (per process). boot() just guarantees that import has run before a
// server entry point touches the DB. Idempotent and effectively free after the
// first call.
export function boot() {
  void db;
}
