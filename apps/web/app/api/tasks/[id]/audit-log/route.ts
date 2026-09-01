import { NextRequest, NextResponse } from "next/server";
import { AuditLogRepository } from "@pve-agent-console/db";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repo = new AuditLogRepository(getDb());
  return NextResponse.json(repo.listByTask(id));
}
