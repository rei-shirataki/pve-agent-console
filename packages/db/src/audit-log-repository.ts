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
 *
 * 書き込み者は2箇所ある(reply APIハンドラ・instrumentation.tsのバックグラウンド購読)が、
 * 「同じidへの2回目のrecord()は無視される」冪等性のおかげでレースしても壊れない。
 * ただしAPIハンドラは`arguments`(ツール呼び出しの実引数)を知らない
 * (opencodeの`GET /permission`はmetadataを返すが実引数は含まない。実機確認済み)ため、
 * 後から届くイベント購読側がapplyCorrections()でarguments/askedAtだけを補正する。
 * apps/webのモジュールスコープ状態(Mapによる相関)はNext.jsの複数ワーカー間で共有されない
 * ことが実機検証で判明したため、この2段階書き込みに設計変更した(docs/architecture.md参照)。
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

  /**
   * 既存行のarguments/askedAtだけを補正する。record()がAPIハンドラ由来で先に書き込まれた場合、
   * イベント購読側だけが知っている実引数・正確な要求時刻をここで埋める。
   * 対象行が無ければ何もしない(record()自身がイベント購読側発でfull writeした場合はここで
   * 補正の必要が無いため)。
   */
  applyCorrections(id: string, args: Record<string, unknown> | null, askedAt: string): void {
    this.db
      .update(auditLog)
      .set({ argumentsJson: args ? JSON.stringify(args) : null, askedAt })
      .where(eq(auditLog.id, id))
      .run();
  }

  /**
   * reply APIハンドラがopencodeへの実際のreplyに失敗した場合の取り消し用。
   * その場合opencode側で決定は成立していないため、record()で先行書き込みした行を削除する。
   */
  remove(id: string): void {
    this.db.delete(auditLog).where(eq(auditLog.id, id)).run();
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
