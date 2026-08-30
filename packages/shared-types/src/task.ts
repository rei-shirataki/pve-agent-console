import { z } from "zod";

// 障害調査 / 構成変更 / 定期メンテナンス / その他
export const TASK_TYPES = ["incident", "change", "maintenance", "other"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = ["open", "in_progress", "blocked", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

// ユーザー起票 か、調査中にエージェントが自発的に追加したか
export const TASK_ORIGINS = ["user", "agent"] as const;
export type TaskOrigin = (typeof TASK_ORIGINS)[number];

export const taskSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string(),
  type: z.enum(TASK_TYPES),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(TASK_PRIORITIES),
  origin: z.enum(TASK_ORIGINS),
  sourceTaskId: z.string().nullable(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Task = z.infer<typeof taskSchema>;

export const taskCreateInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
  type: z.enum(TASK_TYPES),
  priority: z.enum(TASK_PRIORITIES).default("medium"),
  origin: z.enum(TASK_ORIGINS),
  sourceTaskId: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
});
export type TaskCreateInput = z.infer<typeof taskCreateInputSchema>;

export const taskUpdateInputSchema = z.object({
  id: z.string(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type TaskUpdateInput = z.infer<typeof taskUpdateInputSchema>;

export const taskCommentSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  author: z.enum(["user", "agent"]),
  body: z.string().min(1),
  createdAt: z.string(),
});
export type TaskComment = z.infer<typeof taskCommentSchema>;
