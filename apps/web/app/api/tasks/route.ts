import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { TaskRepository } from "@pve-agent-console/db";
import { taskCreateInputSchema, TASK_TYPES, TASK_STATUSES } from "@pve-agent-console/shared-types";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

const listQuerySchema = z.object({
  type: z.enum(TASK_TYPES).optional(),
  status: z.enum(TASK_STATUSES).optional(),
});

export function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  try {
    const query = listQuerySchema.parse({
      type: searchParams.get("type") ?? undefined,
      status: searchParams.get("status") ?? undefined,
    });
    const repo = new TaskRepository(getDb());
    return NextResponse.json(repo.listTasks(query));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const repo = new TaskRepository(getDb());
  const json: unknown = await request.json();
  try {
    const input = taskCreateInputSchema.parse(json);
    const task = repo.createTask(input);
    return NextResponse.json(task, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
