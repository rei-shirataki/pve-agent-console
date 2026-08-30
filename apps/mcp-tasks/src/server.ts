import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDb } from "@pve-agent-console/db";
import {
  taskCreateInputSchema,
  taskUpdateInputSchema,
  TASK_TYPES,
  TASK_STATUSES,
} from "@pve-agent-console/shared-types";
import { TaskRepository } from "./repository.js";

const databasePath = process.env.DATABASE_PATH ?? "./data/pve-agent-console.db";
const db = createDb(databasePath);
const repo = new TaskRepository(db);

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

const server = new McpServer({ name: "pve-agent-console-mcp-tasks", version: "0.1.0" });

server.registerTool(
  "task_create",
  {
    title: "タスクを作成する",
    description:
      "障害調査(incident)/構成変更(change)/定期メンテナンス(maintenance)/その他(other)のタスクを1件作成する。" +
      "調査中に見つかった要対応事項も origin: 'agent' として同じツールで作成できる。",
    inputSchema: taskCreateInputSchema.shape,
  },
  (args) => jsonResult(repo.createTask(args)),
);

server.registerTool(
  "task_list",
  {
    title: "タスク一覧を取得する",
    description: "type/statusで絞り込んでタスク一覧を取得する(条件省略時は全件)",
    inputSchema: {
      type: z.enum(TASK_TYPES).optional(),
      status: z.enum(TASK_STATUSES).optional(),
    },
  },
  (args) => jsonResult(repo.listTasks(args)),
);

server.registerTool(
  "task_get",
  {
    title: "タスクを1件取得する",
    description: "idを指定してタスク詳細を取得する",
    inputSchema: { id: z.string() },
  },
  ({ id }) => {
    const task = repo.getTask(id);
    return task ? jsonResult(task) : errorResult(`task not found: ${id}`);
  },
);

server.registerTool(
  "task_update",
  {
    title: "タスクを更新する",
    description: "status/priority/description/tagsのいずれか(複数可)を更新する",
    inputSchema: taskUpdateInputSchema.shape,
  },
  (args) => jsonResult(repo.updateTask(args)),
);

server.registerTool(
  "task_link",
  {
    title: "タスクの発生元を紐づける",
    description:
      "調査・作業中に見つかったタスク(id)を、発生元のタスク(sourceTaskId)にリンクする",
    inputSchema: { id: z.string(), sourceTaskId: z.string() },
  },
  ({ id, sourceTaskId }) => jsonResult(repo.linkTask(id, sourceTaskId)),
);

server.registerTool(
  "task_add_comment",
  {
    title: "タスクに進捗コメントを追加する",
    description: "調査・作業の進捗や所見をタスクに記録する",
    inputSchema: {
      taskId: z.string(),
      author: z.enum(["user", "agent"]),
      body: z.string().min(1),
    },
  },
  ({ taskId, author, body }) => jsonResult(repo.addComment(taskId, author, body)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
