import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { TaskRepository } from "@pve-agent-console/db";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

const bodySchema = z.object({
  author: z.enum(["user", "agent"]).default("user"),
  body: z.string().min(1),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repo = new TaskRepository(getDb());
  const json: unknown = await request.json();
  try {
    const input = bodySchema.parse(json);
    return NextResponse.json(repo.addComment(id, input.author, input.body), { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
