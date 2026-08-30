import { NextRequest, NextResponse } from "next/server";
import { TaskRepository } from "@pve-agent-console/db";
import { taskUpdateInputSchema } from "@pve-agent-console/shared-types";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repo = new TaskRepository(getDb());
  const task = repo.getTask(id);
  if (!task) {
    return NextResponse.json({ error: `task not found: ${id}` }, { status: 404 });
  }
  return NextResponse.json({ task, comments: repo.listComments(id) });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repo = new TaskRepository(getDb());
  const json: unknown = await request.json();
  try {
    const input = taskUpdateInputSchema.parse({ ...(json as object), id });
    return NextResponse.json(repo.updateTask(input));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
