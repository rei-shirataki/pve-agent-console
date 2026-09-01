import { notFound } from "next/navigation";
import { TaskRepository, AuditLogRepository } from "@pve-agent-console/db";
import { getDb } from "@/lib/db";
import { getOpencodeClient } from "@/lib/opencode-client";
import { listPermissions } from "@/lib/opencode-permissions";
import { resolveRiskTier } from "@/lib/opencode-config";
import { TASK_TYPE_LABELS, TASK_STATUS_LABELS, TASK_PRIORITY_LABELS } from "@/lib/labels";
import TaskDetailClient from "@/components/TaskDetailClient";

export const dynamic = "force-dynamic";

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const taskRepo = new TaskRepository(getDb());
  const auditRepo = new AuditLogRepository(getDb());

  const task = taskRepo.getTask(id);
  if (!task) notFound();
  const comments = taskRepo.listComments(id);
  const auditLog = auditRepo.listByTask(id);

  let pendingPermissions: { id: string; toolName: string; riskTier: "write" | "destructive" | null }[] = [];
  try {
    const { baseUrl } = await getOpencodeClient();
    const all = await listPermissions(baseUrl);
    pendingPermissions = all
      .filter((p) => p.sessionID === task.opencodeSessionId)
      .map((p) => ({ id: p.id, toolName: p.permission, riskTier: resolveRiskTier(p.permission) }));
  } catch {
    // opencode server起動直後などで取得できない場合はクライアント側のポーリングに任せる
  }

  return (
    <>
      <h1>{task.title}</h1>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <span className={`badge type-${task.type}`}>{TASK_TYPE_LABELS[task.type]}</span>
        <span className="badge">{TASK_STATUS_LABELS[task.status]}</span>
        <span className="badge">優先度: {TASK_PRIORITY_LABELS[task.priority]}</span>
        {task.origin === "agent" && <span className="badge">エージェント起票</span>}
      </div>
      {task.description && <p>{task.description}</p>}

      <TaskDetailClient
        task={task}
        initialComments={comments}
        initialPendingPermissions={pendingPermissions}
        initialAuditLog={auditLog}
      />
    </>
  );
}
