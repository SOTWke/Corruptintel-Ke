import type { PoolClient } from "pg";

export interface AuditLogEntry {
  actorUserId: string | null;
  actorType: "human" | "system" | "ai";
  action: string; // e.g. 'case.publish', 'entity.merge', 'case.status_change'
  targetTable: string;
  targetId: string;
  beforeState?: unknown;
  afterState?: unknown;
}

/**
 * Writes an audit_logs row. Intended to be called INSIDE the same
 * transaction as the mutation it records (pass the transaction's client),
 * per Security Architecture §6: "every write to a published table... goes
 * through code that also writes audit_logs in the same transaction."
 */
export async function writeAuditLog(client: PoolClient, entry: AuditLogEntry): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (actor_user_id, actor_type, action, target_table, target_id, before_state, after_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.actorUserId,
      entry.actorType,
      entry.action,
      entry.targetTable,
      entry.targetId,
      entry.beforeState ? JSON.stringify(entry.beforeState) : null,
      entry.afterState ? JSON.stringify(entry.afterState) : null,
    ]
  );
}
