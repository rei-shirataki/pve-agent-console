import { and, eq, type SQL } from "drizzle-orm";
import type { Approval, ApprovalStatus } from "@pve-agent-console/shared-types";
import { approvals } from "./schema.js";
import type { Db } from "./client.js";

function rowToApproval(row: typeof approvals.$inferSelect): Approval {
  return {
    id: row.id,
    taskId: row.taskId,
    toolName: row.toolName,
    arguments: JSON.parse(row.argumentsJson) as Record<string, unknown>,
    riskTier: row.riskTier,
    status: row.status,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    decidedBy: row.decidedBy,
    executedAt: row.executedAt,
    result: row.resultJson ? JSON.parse(row.resultJson) : null,
  };
}

export interface ApprovalListFilter {
  status?: ApprovalStatus;
  taskId?: string;
}

/**
 * 承認キューの一覧表示・決定(承認/却下)を担う。実際のPVE操作の実行・冪等性の担保は
 * apps/mcp-proxmoxのApprovalGateが行う(ここではstatusを書き換えるだけで、実行はしない)。
 */
export class ApprovalRepository {
  constructor(private readonly db: Db) {}

  listApprovals(filter: ApprovalListFilter = {}): Approval[] {
    const conditions: SQL[] = [];
    if (filter.status) conditions.push(eq(approvals.status, filter.status));
    if (filter.taskId) conditions.push(eq(approvals.taskId, filter.taskId));

    const rows =
      conditions.length > 0
        ? this.db
            .select()
            .from(approvals)
            .where(and(...conditions))
            .all()
        : this.db.select().from(approvals).all();
    return rows.map(rowToApproval).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getApproval(id: string): Approval | null {
    const row = this.db.select().from(approvals).where(eq(approvals.id, id)).get();
    return row ? rowToApproval(row) : null;
  }

  decide(id: string, decision: "approved" | "rejected", decidedBy: string): Approval {
    const row = this.db.select().from(approvals).where(eq(approvals.id, id)).get();
    if (!row) throw new Error(`approval not found: ${id}`);
    if (row.status !== "pending") {
      throw new Error(`approval ${id} is already ${row.status}, cannot decide again`);
    }
    this.db
      .update(approvals)
      .set({ status: decision, decidedAt: new Date().toISOString(), decidedBy })
      .where(eq(approvals.id, id))
      .run();
    const updated = this.getApproval(id);
    if (!updated) throw new Error(`approval not found after update: ${id}`);
    return updated;
  }
}
