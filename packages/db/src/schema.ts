import { sqliteTable, text, index } from "drizzle-orm/sqlite-core";

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  type: text("type", { enum: ["incident", "change", "maintenance", "other"] }).notNull(),
  status: text("status", {
    enum: ["open", "in_progress", "blocked", "done", "cancelled"],
  })
    .notNull()
    .default("open"),
  priority: text("priority", { enum: ["low", "medium", "high", "critical"] })
    .notNull()
    .default("medium"),
  origin: text("origin", { enum: ["user", "agent"] }).notNull(),
  sourceTaskId: text("source_task_id"),
  // 自由記述タグ。JSON配列としてTEXTカラムに格納する
  tagsJson: text("tags_json").notNull().default("[]"),
  // 対応するopencodeセッション(1タスク=1セッションが基本、Phase 3で利用開始)
  opencodeSessionId: text("opencode_session_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const taskComments = sqliteTable(
  "task_comments",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    author: text("author", { enum: ["user", "agent"] }).notNull(),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("task_comments_task_id_idx").on(table.taskId)],
);

// write/destructiveのPVE操作について、opencodeのpermission機構が発行した承認要求・決定の履歴。
// 実行ブロックの実体はopencode server側にあり(docs/adr/0001-adopt-opencode.md参照)、
// このテーブルは「誰が・いつ・何を・どう決定したか」を記録する受動的な監査ログでしかない。
// idにはopencodeのpermission request id("per_..."形式)をそのまま使い、
// イベント購読処理が同じ決定を二重に書き込んでも上書きになるだけで済むようにする(冪等性)。
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(), // opencodeのpermission request id
    sessionId: text("session_id").notNull(), // opencodeのsession id
    taskId: text("task_id"), // sessionIdからtasks.opencodeSessionIdを逆引きできた場合のみ設定
    toolName: text("tool_name").notNull(),
    argumentsJson: text("arguments_json"),
    // ツール名からriskTierを解決できた場合のみ設定(fail-closedの都合上、解決できないことがある)
    riskTier: text("risk_tier", { enum: ["write", "destructive"] }),
    decision: text("decision", { enum: ["approved", "rejected"] }).notNull(),
    decidedBy: text("decided_by"),
    askedAt: text("asked_at").notNull(),
    decidedAt: text("decided_at").notNull(),
  },
  (table) => [
    index("audit_log_task_id_idx").on(table.taskId),
    index("audit_log_session_id_idx").on(table.sessionId),
  ],
);
