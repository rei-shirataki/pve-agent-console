import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApprovalRepository } from "@pve-agent-console/db";
import { APPROVAL_STATUSES } from "@pve-agent-console/shared-types";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

const listQuerySchema = z.object({
  status: z.enum(APPROVAL_STATUSES).optional(),
  taskId: z.string().optional(),
});

export function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  try {
    const query = listQuerySchema.parse({
      status: searchParams.get("status") ?? undefined,
      taskId: searchParams.get("taskId") ?? undefined,
    });
    const repo = new ApprovalRepository(getDb());
    return NextResponse.json(repo.listApprovals(query));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
