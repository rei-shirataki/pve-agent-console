import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApprovalRepository } from "@pve-agent-console/db";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

const bodySchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  decidedBy: z.string().default("web-ui-user"),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repo = new ApprovalRepository(getDb());
  const json: unknown = await request.json();
  try {
    const input = bodySchema.parse(json);
    return NextResponse.json(repo.decide(id, input.decision, input.decidedBy));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
