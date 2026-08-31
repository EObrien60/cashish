import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db, schema, type Db } from "@cashish/core/db";

// ---------------------------------------------------------------------------
// The audit log.
//
// Every mutation the console performs goes through withAudit, which writes the
// change and its record in ONE transaction. That is the whole design: a log
// written afterwards, on a best-effort basis, is a log that is missing exactly
// the row you will want — the one where the mutation half-succeeded, or where
// the process died between the two writes.
//
// It follows that callers must not hold a reference to `db` and write through
// that instead. withAudit passes the transaction handle into the callback, so
// the honest path is also the shortest one.
//
// Append-only. There is no delete here and the console offers none.
// ---------------------------------------------------------------------------

const { adminAuditLog } = schema;

export type SubjectType = "tenant" | "user" | "subscription" | "plan";

export type AuditEntry = {
  action: string;
  subjectType: SubjectType;
  subjectId: string;
  /** Null for actions that are not about one tenant, such as editing a plan. */
  tenantId?: string | null;
  before?: unknown;
  after?: unknown;
};

/** JSON, or null. Undefined and null both mean "there was nothing here". */
function serialise(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

/**
 * Runs a mutation and records it, atomically.
 *
 * The callback receives the transaction; anything it writes commits with the
 * audit row or not at all. Its return value is passed through.
 */
export async function withAudit<T>(
  adminId: string,
  entry: AuditEntry | ((result: T) => AuditEntry),
  fn: (trx: Db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (trx) => {
    const result = await fn(trx as unknown as Db);
    const resolved = typeof entry === "function" ? entry(result) : entry;
    await (trx as unknown as Db).insert(adminAuditLog).values({
      id: randomUUID(),
      adminId,
      action: resolved.action,
      subjectType: resolved.subjectType,
      subjectId: resolved.subjectId,
      tenantId: resolved.tenantId ?? null,
      before: serialise(resolved.before),
      after: serialise(resolved.after),
    });
    return result;
  });
}

export type AuditRow = {
  id: string;
  action: string;
  subjectType: string;
  subjectId: string;
  tenantId: string | null;
  before: string | null;
  after: string | null;
  createdAt: string;
  adminEmail: string;
};

export async function listAudit(limit = 200): Promise<AuditRow[]> {
  const { platformAdmins } = schema;
  const rows = await db
    .select({
      id: adminAuditLog.id,
      action: adminAuditLog.action,
      subjectType: adminAuditLog.subjectType,
      subjectId: adminAuditLog.subjectId,
      tenantId: adminAuditLog.tenantId,
      before: adminAuditLog.before,
      after: adminAuditLog.after,
      createdAt: adminAuditLog.createdAt,
      adminEmail: platformAdmins.email,
    })
    .from(adminAuditLog)
    .innerJoin(platformAdmins, eq(platformAdmins.id, adminAuditLog.adminId))
    .orderBy(desc(adminAuditLog.createdAt))
    .limit(limit);
  return rows;
}

export async function auditForSubject(
  subjectType: SubjectType,
  subjectId: string,
  limit = 50,
): Promise<AuditRow[]> {
  return (await listAudit(1000))
    .filter((row) => row.subjectType === subjectType && row.subjectId === subjectId)
    .slice(0, limit);
}
