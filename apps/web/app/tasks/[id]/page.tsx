import { notFound } from "next/navigation";
import { TaskRepository, ApprovalRepository } from "@pve-agent-console/db";
import { getDb } from "@/lib/db";
import { TASK_TYPE_LABELS, TASK_STATUS_LABELS, TASK_PRIORITY_LABELS } from "@/lib/labels";
import TaskDetailClient from "@/components/TaskDetailClient";

export const dynamic = "force-dynamic";

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const taskRepo = new TaskRepository(getDb());
  const approvalRepo = new ApprovalRepository(getDb());

  const task = taskRepo.getTask(id);
  if (!task) notFound();
  const comments = taskRepo.listComments(id);
  const approvals = approvalRepo.listApprovals({ taskId: id });

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

      <TaskDetailClient task={task} initialComments={comments} initialApprovals={approvals} />
    </>
  );
}
