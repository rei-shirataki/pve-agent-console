"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Task } from "@pve-agent-console/shared-types";
import { TASK_TYPE_LABELS } from "@/lib/labels";

interface Props {
  initialTasks: Task[];
  initialPendingCount: number;
}

const POLL_MS = 5000;

export default function Sidebar({ initialTasks, initialPendingCount }: Props) {
  const pathname = usePathname();
  const [tasks, setTasks] = useState(initialTasks);
  const [pendingCount, setPendingCount] = useState(initialPendingCount);

  useEffect(() => {
    const timer = setInterval(() => {
      fetch("/api/tasks")
        .then((res) => {
          if (res.status === 401) {
            window.location.href = "/login";
            return null;
          }
          return res.ok ? (res.json() as Promise<Task[]>) : null;
        })
        .then((data) => {
          if (data) setTasks(data);
        })
        .catch(() => {
          /* ポーリング失敗は無視して次回再試行 */
        });
      fetch("/api/permissions")
        .then((res) => (res.ok ? (res.json() as Promise<unknown[]>) : null))
        .then((data) => {
          if (data) setPendingCount(data.length);
        })
        .catch(() => {
          /* ポーリング失敗は無視して次回再試行 */
        });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const sorted = [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="dot" />
        pve-agent-console
      </div>

      <div className="sidebar-new-task">
        <Link href="/">+ 新しいタスク</Link>
      </div>

      <div className="sidebar-section-title">タスク</div>
      <nav className="sidebar-tasks">
        {sorted.length === 0 && <p className="muted" style={{ padding: "0 16px" }}>まだありません</p>}
        {sorted.map((task) => {
          const href = `/tasks/${task.id}`;
          const active = pathname === href;
          return (
            <Link key={task.id} href={href} className={`sidebar-task${active ? " active" : ""}`}>
              <div className="title">{task.title}</div>
              <div className="meta">{TASK_TYPE_LABELS[task.type]}</div>
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <Link href="/approvals" className="sidebar-approvals-link">
          <span>承認キュー</span>
          {pendingCount > 0 && <span className="sidebar-approvals-count">{pendingCount}</span>}
        </Link>
        <button className="sidebar-logout" onClick={() => void logout()}>
          ログアウト
        </button>
      </div>
    </aside>
  );
}
