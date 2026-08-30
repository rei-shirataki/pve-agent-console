import { randomUUID } from "node:crypto";
import { and, eq, type SQL } from "drizzle-orm";
import { tasks, taskComments, type Db } from "@pve-agent-console/db";
import type {
  Task,
  TaskComment,
  TaskCreateInput,
  TaskUpdateInput,
  TaskStatus,
  TaskType,
} from "@pve-agent-console/shared-types";

function rowToTask(row: typeof tasks.$inferSelect): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    status: row.status,
    priority: row.priority,
    origin: row.origin,
    sourceTaskId: row.sourceTaskId,
    tags: JSON.parse(row.tagsJson) as string[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface TaskListFilter {
  type?: TaskType;
  status?: TaskStatus;
}

export class TaskRepository {
  constructor(private readonly db: Db) {}

  createTask(input: TaskCreateInput): Task {
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      title: input.title,
      description: input.description,
      type: input.type,
      status: "open" as const,
      priority: input.priority,
      origin: input.origin,
      sourceTaskId: input.sourceTaskId,
      tagsJson: JSON.stringify(input.tags),
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(tasks).values(row).run();
    return rowToTask(row);
  }

  listTasks(filter: TaskListFilter = {}): Task[] {
    const conditions: SQL[] = [];
    if (filter.type) conditions.push(eq(tasks.type, filter.type));
    if (filter.status) conditions.push(eq(tasks.status, filter.status));

    const rows =
      conditions.length > 0
        ? this.db
            .select()
            .from(tasks)
            .where(and(...conditions))
            .all()
        : this.db.select().from(tasks).all();
    return rows.map(rowToTask);
  }

  getTask(id: string): Task | null {
    const row = this.db.select().from(tasks).where(eq(tasks.id, id)).get();
    return row ? rowToTask(row) : null;
  }

  updateTask(input: TaskUpdateInput): Task {
    const patch: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date().toISOString() };
    if (input.status !== undefined) patch.status = input.status;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.description !== undefined) patch.description = input.description;
    if (input.tags !== undefined) patch.tagsJson = JSON.stringify(input.tags);

    this.db.update(tasks).set(patch).where(eq(tasks.id, input.id)).run();
    const updated = this.getTask(input.id);
    if (!updated) throw new Error(`task not found: ${input.id}`);
    return updated;
  }

  linkTask(id: string, sourceTaskId: string): Task {
    this.db
      .update(tasks)
      .set({ sourceTaskId, updatedAt: new Date().toISOString() })
      .where(eq(tasks.id, id))
      .run();
    const updated = this.getTask(id);
    if (!updated) throw new Error(`task not found: ${id}`);
    return updated;
  }

  addComment(taskId: string, author: "user" | "agent", body: string): TaskComment {
    const row = {
      id: randomUUID(),
      taskId,
      author,
      body,
      createdAt: new Date().toISOString(),
    };
    this.db.insert(taskComments).values(row).run();
    return row;
  }
}
