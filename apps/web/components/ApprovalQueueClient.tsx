"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AuditLogEntry } from "@pve-agent-console/shared-types";

interface PendingPermission {
  id: string;
  toolName: string;
  riskTier: "write" | "destructive" | null;
  sessionId: string;
}

interface Props {
  initialPending: PendingPermission[];
  initialHistory: AuditLogEntry[];
  taskTitles: Record<string, string>;
  taskIds: Record<string, string>;
}

const POLL_MS = 4000;

export default function ApprovalQueueClient({ initialPending, initialHistory, taskTitles, taskIds }: Props) {
  const [pending, setPending] = useState(initialPending);
  const [history, setHistory] = useState(initialHistory);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      fetch("/api/permissions")
        .then((res) => (res.ok ? (res.json() as Promise<PendingPermission[]>) : null))
        .then((data) => {
          if (data) setPending(data);
        })
        .catch(() => {
          /* ポーリング失敗は無視して次回再試行 */
        });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  async function decide(permissionId: string, action: "once" | "reject") {
    await fetch(`/api/permissions/${permissionId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const [pendingRes, historyRes] = await Promise.all([fetch("/api/permissions"), fetch("/api/audit-log")]);
    if (pendingRes.ok) setPending((await pendingRes.json()) as PendingPermission[]);
    if (historyRes.ok) setHistory((await historyRes.json()) as AuditLogEntry[]);
  }

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <button className="secondary" onClick={() => setShowHistory((v) => !v)}>
          {showHistory ? "保留中のみ表示" : "履歴を表示"}
        </button>
      </div>

      {!showHistory && (
        <>
          {pending.length === 0 && <p className="muted">承認待ちの操作はありません。</p>}
          {pending.map((p) => (
            <div className="card" key={p.id}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {p.riskTier && <span className={`badge risk-${p.riskTier}`}>{p.riskTier}</span>}
                <code>{p.toolName}</code>
                {taskIds[p.sessionId] && (
                  <Link href={`/tasks/${taskIds[p.sessionId]}`} style={{ fontSize: 13 }}>
                    {taskTitles[p.sessionId] ?? p.sessionId}
                  </Link>
                )}
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <button onClick={() => void decide(p.id, "once")}>承認</button>
                <button className="danger" onClick={() => void decide(p.id, "reject")}>
                  却下
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {showHistory && (
        <>
          {history.length === 0 && <p className="muted">履歴はまだありません。</p>}
          {history.map((entry) => (
            <div className="card" key={entry.id}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {entry.riskTier && <span className={`badge risk-${entry.riskTier}`}>{entry.riskTier}</span>}
                <code>{entry.toolName}</code>
                <span className="muted" style={{ fontSize: 12 }}>
                  {new Date(entry.decidedAt).toLocaleString("ja-JP")}
                </span>
                {entry.taskId && (
                  <Link href={`/tasks/${entry.taskId}`} style={{ fontSize: 13 }}>
                    {taskTitles[entry.sessionId] ?? entry.taskId}
                  </Link>
                )}
              </div>
              <span className={entry.decision === "approved" ? "badge" : "badge risk-destructive"}>
                {entry.decision}
              </span>
            </div>
          ))}
        </>
      )}
    </>
  );
}
