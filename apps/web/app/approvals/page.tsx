import { TaskRepository, AuditLogRepository } from "@pve-agent-console/db";
import { getDb } from "@/lib/db";
import { getOpencodeClient } from "@/lib/opencode-client";
import { listPermissions } from "@/lib/opencode-permissions";
import { resolveRiskTier } from "@/lib/opencode-config";
import ApprovalQueueClient from "@/components/ApprovalQueueClient";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const taskRepo = new TaskRepository(getDb());
  const auditRepo = new AuditLogRepository(getDb());
  const tasksBySession = new Map(
    taskRepo.listTasks().flatMap((t) => (t.opencodeSessionId ? [[t.opencodeSessionId, t]] as const : [])),
  );
  const taskTitles = Object.fromEntries([...tasksBySession].map(([sid, t]) => [sid, t.title]));
  const taskIds = Object.fromEntries([...tasksBySession].map(([sid, t]) => [sid, t.id]));

  let pending: { id: string; toolName: string; riskTier: "write" | "destructive" | null; sessionId: string }[] = [];
  try {
    const { baseUrl } = await getOpencodeClient();
    const all = await listPermissions(baseUrl);
    pending = all.map((p) => ({
      id: p.id,
      toolName: p.permission,
      riskTier: resolveRiskTier(p.permission),
      sessionId: p.sessionID,
    }));
  } catch {
    // opencode server起動直後などで取得できない場合はクライアント側のポーリングに任せる
  }

  const history = auditRepo.list();

  return (
    <>
      <h1>承認キュー</h1>
      <p className="muted">
        write/destructiveのPVE操作はすべてここに保留されます。承認・却下してください。
      </p>
      <ApprovalQueueClient
        initialPending={pending}
        initialHistory={history}
        taskTitles={taskTitles}
        taskIds={taskIds}
      />
    </>
  );
}
