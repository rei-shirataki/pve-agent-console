import { TaskRepository, ApprovalRepository } from "@pve-agent-console/db";
import { getDb } from "@/lib/db";
import ApprovalQueueClient from "@/components/ApprovalQueueClient";

export const dynamic = "force-dynamic";

export default function ApprovalsPage() {
  const approvalRepo = new ApprovalRepository(getDb());
  const taskRepo = new TaskRepository(getDb());

  const approvals = approvalRepo.listApprovals();
  const taskTitles = Object.fromEntries(
    taskRepo.listTasks().map((t) => [t.id, t.title] as const),
  );

  return (
    <>
      <h1>承認キュー</h1>
      <p className="muted">
        write/destructiveのPVE操作はすべてここに保留されます。承認・却下してください。
      </p>
      <ApprovalQueueClient initialApprovals={approvals} taskTitles={taskTitles} />
    </>
  );
}
