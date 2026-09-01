import { eq } from "drizzle-orm";
import type { AuditLogEntry } from "@pve-agent-console/shared-types";
import { auditLog } from "./schema.js";
import type { Db } from "./client.js";

function rowToEntry(row: typeof auditLog.$inferSelect): AuditLogEntry {
  return {
    id: row.id,
    sessionId: row.sessionId,
    taskId: row.taskId,
    toolName: row.toolName,
    arguments: row.argumentsJson ? (JSON.parse(row.argumentsJson) as Record<string, unknown>) : null,
    riskTier: row.riskTier,
    decision: row.decision,
    decidedBy: row.decidedBy,
    askedAt: row.askedAt,
    decidedAt: row.decidedAt,
  };
}

export interface AuditLogRecordInput {
  id: string; // opencodeのpermission request id
  sessionId: string;
  taskId: string | null;
  toolName: string;
  arguments: Record<string, unknown> | null;
  riskTier: "write" | "destructive" | null;
  decision: "approved" | "rejected";
  decidedBy: string | null;
  askedAt: string;
  decidedAt: string;
}

/**
 * opencodeのpermission機構が発行した承認要求・決定の受動的な監査ログ。
 * idにopencodeのpermission request idをそのまま使うため、同じ決定が二重に届いても
 * record()は初回書き込みだけが反映される(冪等)。docs/adr/0001-adopt-opencode.md参照。
 */
export class AuditLogRepository {
  constructor(private readonly db: Db) {}

  record(input: AuditLogRecordInput): void {
    this.db
      .insert(auditLog)
      .values({
        id: input.id,
        sessionId: input.sessionId,
        taskId: input.taskId,
        toolName: input.toolName,
        argumentsJson: input.arguments ? JSON.stringify(input.arguments) : null,
        riskTier: input.riskTier,
        decision: input.decision,
        decidedBy: input.decidedBy,
        askedAt: input.askedAt,
        decidedAt: input.decidedAt,
      })
      .onConflictDoNothing()
      .run();
  }

  listByTask(taskId: string): AuditLogEntry[] {
    return this.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.taskId, taskId))
      .all()
      .map(rowToEntry)
      .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
  }

  list(): AuditLogEntry[] {
    return this.db
      .select()
      .from(auditLog)
      .all()
      .map(rowToEntry)
      .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
  }
}
