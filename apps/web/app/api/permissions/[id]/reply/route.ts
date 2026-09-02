import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuditLogRepository, TaskRepository } from "@pve-agent-console/db";
import { getDb } from "@/lib/db";
import { getOpencodeClient } from "@/lib/opencode-client";
import { listPermissions, replyToPermission } from "@/lib/opencode-permissions";
import { resolveRiskTier } from "@/lib/opencode-config";

export const runtime = "nodejs";

const bodySchema = z.object({
  action: z.enum(["once", "always", "reject"]),
});

/**
 * 承認/却下をopencodeへ転送する。承認者(x-pve-user、Proxyが検証済みセッションから
 * セットする)を記録するため、opencodeへPOSTする「前」にaudit_logへ最小限の行を
 * 書き込んでからreplyする(この順序なら必ずinstrumentation.tsのイベント購読処理より
 * 先に完了する。opencodeへのPOSTが完了して初めてpermission.repliedイベントが
 * 発行されるため)。
 *
 * 当初はモジュールスコープのMapでAPIハンドラ→イベント購読処理へ承認者を受け渡す設計
 * だったが、Next.jsの複数ワーカー間でモジュール状態が共有されないことが実機検証で
 * 判明したため、DBの行そのものを介して受け渡す設計に変更した(docs/architecture.md参照)。
 * `arguments`(実際のツール呼び出し引数)はopencodeの`GET /permission`には含まれず
 * イベント購読側でしか取得できないため、そちらは後からAuditLogRepository.applyCorrections()
 * で補正される。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { baseUrl } = await getOpencodeClient();
  const json: unknown = await request.json();

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const decidedBy = request.headers.get("x-pve-user");
  const auditRepo = new AuditLogRepository(getDb());
  let wroteRow = false;

  try {
    const pending = (await listPermissions(baseUrl)).find((p) => p.id === id);
    if (pending) {
      const taskRepo = new TaskRepository(getDb());
      const task = taskRepo.getTaskByOpencodeSessionId(pending.sessionID);
      const now = new Date().toISOString();
      auditRepo.record({
        id,
        sessionId: pending.sessionID,
        taskId: task?.id ?? null,
        toolName: pending.permission,
        arguments: null, // イベント購読側がapplyCorrections()で補正する
        riskTier: resolveRiskTier(pending.permission),
        decision: parsed.data.action === "reject" ? "rejected" : "approved",
        decidedBy,
        askedAt: now, // 正確な要求時刻はイベント購読側がapplyCorrections()で補正する
        decidedAt: now,
      });
      wroteRow = true;
    }

    await replyToPermission(baseUrl, id, parsed.data.action);
    return NextResponse.json({ ok: true });
  } catch (err) {
    // opencodeへのreplyが実際には届いていないのに「決定済み」の行が残ると
    // 存在しない承認を主張する監査ログになるため、書き込み済みなら取り消す
    if (wroteRow) auditRepo.remove(id);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
