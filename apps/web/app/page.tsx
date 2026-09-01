import Link from "next/link";
import { TaskRepository } from "@pve-agent-console/db";
import { getDb } from "@/lib/db";
import { TASK_TYPE_LABELS, TASK_STATUS_LABELS, TASK_PRIORITY_LABELS } from "@/lib/labels";
import CreateTaskForm from "@/components/CreateTaskForm";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const repo = new TaskRepository(getDb());
  const tasks = repo.listTasks();

  return (
    <>
      <h1>タスク</h1>
      <p className="muted">
        障害調査・構成変更・定期メンテナンス・その他のタスクを、種類を問わず一元管理します。
      </p>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>新しいタスクを作成</h3>
        <CreateTaskForm />
      </div>

      {tasks.length === 0 ? (
        <p className="muted">タスクはまだありません。</p>
      ) : (
        tasks.map((task) => (
          <Link key={task.id} href={`/tasks/${task.id}`} style={{ textDecoration: "none" }}>
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong>{task.title}</strong>
                <span className="muted" style={{ fontSize: 12 }}>
                  優先度: {TASK_PRIORITY_LABELS[task.priority]}
                </span>
              </div>
              <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className={`badge type-${task.type}`}>{TASK_TYPE_LABELS[task.type]}</span>
                <span className="badge">{TASK_STATUS_LABELS[task.status]}</span>
                {task.origin === "agent" && <span className="badge">エージェント起票</span>}
                {task.tags.map((tag) => (
                  <span key={tag} className="badge">
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          </Link>
        ))
      )}
    </>
  );
}
