import { NextResponse } from "next/server";
import { AuditLogRepository } from "@pve-agent-console/db";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export function GET() {
  const repo = new AuditLogRepository(getDb());
  return NextResponse.json(repo.list());
}
