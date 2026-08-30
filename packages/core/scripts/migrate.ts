#!/usr/bin/env tsx
/**
 * CLI entry point for the migrator. The logic lives in ../src/migrate.ts so the
 * test harness can call it directly instead of spawning a process.
 */
import { migrate } from "../src/migrate";

migrate().catch((error) => {
  console.error("migration failed:", error);
  process.exit(1);
});
