"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Approval } from "@pve-agent-console/shared-types";

interface Props {
  initialApprovals: Approval[];
  taskTitles: Record<string, string>;
}

const POLL_MS = 4000;

export default function ApprovalQueueClient({ initialApprovals, taskTitles }: Props) {
  const [approvals, setApprovals] = useState(initialApprovals);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      fetch("/api/approvals")
        .then((res) => (res.ok ? (res.json() as Promise<Approval[]>) : null))
        .then((data) => {
          if (data) setApprovals(data);
        })
        .catch(() => {
          /* ポーリング失敗は無視して次回再試行 */
        });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  async function decide(approvalId: string, decision: "approved" | "rejected") {
    await fetch(`/api/approvals/${approvalId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const res = await fetch("/api/approvals");
    if (res.ok) setApprovals((await res.json()) as Approval[]);
  }

  const visible = showAll ? approvals : approvals.filter((a) => a.status === "pending");

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <button className="secondary" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "保留中のみ表示" : "すべて表示"}
        </button>
      </div>

      {visible.length === 0 && <p className="muted">対象の承認はありません。</p>}

      {visible.map((a) => (
        <div className="card" key={a.id}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className={`badge risk-${a.riskTier}`}>{a.riskTier}</span>
            <code>{a.toolName}</code>
            <span className="muted" style={{ fontSize: 12 }}>
              {a.status}
            </span>
            {a.taskId && (
              <Link href={`/tasks/${a.taskId}`} style={{ fontSize: 13 }}>
                {taskTitles[a.taskId] ?? a.taskId}
              </Link>
            )}
          </div>
          <pre className="muted" style={{ fontSize: 12, margin: "8px 0" }}>
            {JSON.stringify(a.arguments, null, 2)}
          </pre>
          {a.status === "pending" && (
            <div className="row">
              <button onClick={() => void decide(a.id, "approved")}>承認</button>
              <button className="danger" onClick={() => void decide(a.id, "rejected")}>
                却下
              </button>
            </div>
          )}
          {a.status !== "pending" && a.result !== null && (
            <pre className="muted" style={{ fontSize: 12 }}>
              結果: {JSON.stringify(a.result)}
            </pre>
          )}
        </div>
      ))}
    </>
  );
}
