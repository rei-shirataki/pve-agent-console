"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentEvent, Approval, Task, TaskComment } from "@pve-agent-console/shared-types";

interface Props {
  task: Task;
  initialComments: TaskComment[];
  initialApprovals: Approval[];
}

function eventLabel(event: AgentEvent): string {
  switch (event.type) {
    case "text":
      return event.text;
    case "tool_call":
      return `🔧 ${event.name}(${JSON.stringify(event.args)})`;
    case "tool_result":
      return `↩ ${JSON.stringify(event.result)}`;
    case "error":
      return `⚠ ${event.message}`;
    case "done":
      return event.summary ? `✅ ${event.summary}` : "✅ 完了";
  }
}

/**
 * 承認キューはWeb UI(このコンポーネント)がapprovalsテーブルを定期ポーリングして表示する。
 * docs/architecture.md ではBFFがSSEでブロードキャストする設計だったが、単一ユーザーの
 * ホームラボ用途では素朴なポーリングで十分と判断し簡略化した(architecture.md 7節に記載)。
 */
const APPROVALS_POLL_MS = 4000;

export default function TaskDetailClient({ task, initialComments, initialApprovals }: Props) {
  const [comments, setComments] = useState(initialComments);
  const [approvals, setApprovals] = useState(initialApprovals);
  const [prompt, setPrompt] = useState("");
  const [log, setLog] = useState<AgentEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [lastSessionId, setLastSessionId] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");

  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      fetch(`/api/approvals?taskId=${task.id}`)
        .then((res) => (res.ok ? (res.json() as Promise<Approval[]>) : null))
        .then((data) => {
          if (data) setApprovals(data);
        })
        .catch(() => {
          /* ポーリング失敗は無視して次回再試行 */
        });
    }, APPROVALS_POLL_MS);
    return () => clearInterval(timer);
  }, [task.id]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  async function runAgent(promptText: string, resumeSessionId?: string) {
    if (!promptText.trim() || running) return;
    setRunning(true);
    setLog([]);
    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id, prompt: promptText, resumeSessionId }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`agent run failed to start: ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          const event = JSON.parse(line.slice(5).trim()) as AgentEvent;
          setLog((prev) => [...prev, event]);
          if (event.type === "done") setLastSessionId(event.sessionId);
        }
      }
    } catch (err) {
      setLog((prev) => [
        ...prev,
        { type: "error", message: err instanceof Error ? err.message : String(err) },
      ]);
    } finally {
      setRunning(false);
    }
  }

  async function decide(approvalId: string, decision: "approved" | "rejected") {
    await fetch(`/api/approvals/${approvalId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const res = await fetch(`/api/approvals?taskId=${task.id}`);
    if (res.ok) setApprovals((await res.json()) as Approval[]);
  }

  async function postComment() {
    if (!commentBody.trim()) return;
    const res = await fetch(`/api/tasks/${task.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author: "user", body: commentBody }),
    });
    if (res.ok) {
      const created = (await res.json()) as TaskComment;
      setComments((prev) => [...prev, created]);
      setCommentBody("");
    }
  }

  const pendingApprovedNotYetExecuted = approvals.find((a) => a.status === "approved" && !a.executedAt);

  return (
    <>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>承認待ちの操作</h3>
        {approvals.length === 0 && <p className="muted">このタスクに紐づく承認待ちの操作はありません。</p>}
        {approvals.map((a) => (
          <div
            key={a.id}
            style={{
              borderTop: "1px solid var(--border)",
              paddingTop: 10,
              marginTop: 10,
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className={`badge risk-${a.riskTier}`}>{a.riskTier}</span>
              <code>{a.toolName}</code>
              <span className="muted" style={{ fontSize: 12 }}>
                {a.status}
              </span>
            </div>
            <pre className="muted" style={{ fontSize: 12, margin: "6px 0" }}>
              {JSON.stringify(a.arguments)}
            </pre>
            {a.status === "pending" && (
              <div className="row">
                <button onClick={() => void decide(a.id, "approved")}>承認</button>
                <button className="danger" onClick={() => void decide(a.id, "rejected")}>
                  却下
                </button>
              </div>
            )}
          </div>
        ))}
        {pendingApprovedNotYetExecuted && (
          <p style={{ marginTop: 10 }}>
            承認済みで未実行の操作があります。下の「承認後に再開」でエージェントに続きを実行させてください。
          </p>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>エージェントに依頼する</h3>
        <div className="field">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例: node1のディスク使用率を確認して、原因を調査してほしい"
            disabled={running}
          />
        </div>
        <div className="row">
          <button disabled={running || !prompt.trim()} onClick={() => void runAgent(prompt)}>
            {running ? "実行中..." : "実行"}
          </button>
          <button
            className="secondary"
            disabled={running || !lastSessionId}
            onClick={() =>
              void runAgent(
                "承認されました。approval_checkツールで結果を確認し、作業を続けてください。",
                lastSessionId ?? undefined,
              )
            }
          >
            承認後に再開
          </button>
        </div>

        {log.length > 0 && (
          <div className="event-log" style={{ marginTop: 12 }}>
            {log.map((event, i) => (
              <div className="event-line" key={i}>
                <div className="kind">{event.type}</div>
                <div>{eventLabel(event)}</div>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>コメント</h3>
        {comments.length === 0 && <p className="muted">コメントはまだありません。</p>}
        {comments.map((c) => (
          <div key={c.id} style={{ marginBottom: 10 }}>
            <span className="muted" style={{ fontSize: 12 }}>
              {c.author} · {new Date(c.createdAt).toLocaleString("ja-JP")}
            </span>
            <p style={{ margin: "4px 0 0" }}>{c.body}</p>
          </div>
        ))}
        <div className="row" style={{ marginTop: 10 }}>
          <input
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            placeholder="進捗や所見を記録"
          />
          <button style={{ flex: "0 0 auto" }} onClick={() => void postComment()}>
            追加
          </button>
        </div>
      </div>
    </>
  );
}
