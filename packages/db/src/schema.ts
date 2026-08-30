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

// write/destructive risk tierのPVE操作の承認待ちレコード。
// docs/architecture.md 2.3節「承認フロー(fail-safeなfast-return方式)」を参照。
export const approvals = sqliteTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id"),
    toolName: text("tool_name").notNull(),
    // ツール呼び出し引数(JSON)。approved確定後にexecuted_atがNULLの間だけ実行に使う
    argumentsJson: text("arguments_json").notNull(),
    riskTier: text("risk_tier", { enum: ["write", "destructive"] }).notNull(),
    status: text("status", {
      enum: ["pending", "approved", "rejected", "timeout"],
    })
      .notNull()
      .default("pending"),
    createdAt: text("created_at").notNull(),
    decidedAt: text("decided_at"),
    decidedBy: text("decided_by"),
    // 実際にPVE APIを実行した時刻。設定済みなら再実行しない(冪等性の担保)
    executedAt: text("executed_at"),
    resultJson: text("result_json"),
  },
  (table) => [
    index("approvals_status_idx").on(table.status),
    index("approvals_task_id_idx").on(table.taskId),
  ],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    approvalId: text("approval_id"),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    detailJson: text("detail_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("audit_log_approval_id_idx").on(table.approvalId)],
);
