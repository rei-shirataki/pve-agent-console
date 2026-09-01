import { NextRequest, NextResponse } from "next/server";
import { getOpencodeClient } from "@/lib/opencode-client";
import { listPermissions } from "@/lib/opencode-permissions";
import { resolveRiskTier } from "@/lib/opencode-config";
import { getDb } from "@/lib/db";
import { TaskRepository } from "@pve-agent-console/db";

export const runtime = "nodejs";

/**
 * opencodeの保留中パーミッション要求(承認待ちキュー)をそのままプロキシする。
 * pending状態の真実はopencode側にあり、自前DBにはミラーしない(docs/adr/0001-adopt-opencode.md参照)。
 */
export async function GET(request: NextRequest) {
  const { baseUrl } = await getOpencodeClient();
  const { searchParams } = new URL(request.url);
  const taskIdFilter = searchParams.get("taskId");

  try {
    const pending = await listPermissions(baseUrl);
    const taskRepo = new TaskRepository(getDb());

    const enriched = pending.map((p) => {
      const task = taskRepo.getTaskByOpencodeSessionId(p.sessionID);
      return {
        id: p.id,
        sessionId: p.sessionID,
        taskId: task?.id ?? null,
        toolName: p.permission,
        riskTier: resolveRiskTier(p.permission),
      };
    });

    const filtered = taskIdFilter ? enriched.filter((p) => p.taskId === taskIdFilter) : enriched;
    return NextResponse.json(filtered);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
