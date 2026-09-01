"use client";

import { useEffect, useRef, useState } from "react";
import type { AuditLogEntry, Task, TaskComment } from "@pve-agent-console/shared-types";

interface PendingPermission {
  id: string;
  toolName: string;
  riskTier: "write" | "destructive" | null;
}

interface OpencodeEvent {
  type: string;
  properties?: Record<string, unknown>;
}

interface Props {
  task: Task;
  initialComments: TaskComment[];
  initialPendingPermissions: PendingPermission[];
  initialAuditLog: AuditLogEntry[];
}

const POLL_MS = 4000;

function describeEvent(event: OpencodeEvent): { kind: string; text: string } | null {
  const props = event.properties ?? {};
  switch (event.type) {
    case "message.part.updated": {
      const part = props.part as
        | { type?: string; text?: string; tool?: string; state?: { status?: string; input?: unknown; output?: unknown } }
        | undefined;
      if (!part) return null;
      if (part.type === "text" && part.text) return { kind: "text", text: part.text };
      if (part.type === "reasoning" && part.text) return { kind: "reasoning", text: part.text };
      if (part.type === "tool") {
        const status = part.state?.status ?? "pending";
        if (status === "completed") {
          return { kind: "tool", text: `🔧 ${part.tool}(${JSON.stringify(part.state?.input)}) → ${JSON.stringify(part.state?.output)}` };
        }
        return { kind: "tool", text: `🔧 ${part.tool} [${status}]` };
      }
      return null;
    }
    case "permission.asked":
      return { kind: "permission", text: `⏸ 承認待ち: ${String(props.permission)}` };
    case "permission.replied":
      return { kind: "permission", text: `✅ 決定: ${String(props.reply)}` };
    case "session.status": {
      const status = (props.status as { type?: string } | undefined)?.type;
      return status === "busy" ? null : { kind: "status", text: `セッション状態: ${status}` };
    }
    case "session.error":
      return { kind: "error", text: `⚠ ${String(props.message)}` };
    default:
      return null;
  }
}

export default function TaskDetailClient({
  task,
  initialComments,
  initialPendingPermissions,
  initialAuditLog,
}: Props) {
  const [comments, setComments] = useState(initialComments);
  const [pending, setPending] = useState(initialPendingPermissions);
  const [auditLog, setAuditLog] = useState(initialAuditLog);
  const [prompt, setPrompt] = useState("");
  const [agent, setAgent] = useState<"investigator" | "operator">(
    task.type === "incident" ? "investigator" : "operator",
  );
  const [log, setLog] = useState<{ kind: string; text: string }[]>([]);
  const [running, setRunning] = useState(false);
  const [commentBody, setCommentBody] = useState("");

  const logEndRef = useRef<HTMLDivElement | null>(null);

  const refreshPending = async () => {
    const res = await fetch(`/api/permissions?taskId=${task.id}`);
    if (res.ok) setPending((await res.json()) as PendingPermission[]);
  };

  const refreshAuditLog = async () => {
    const res = await fetch(`/api/tasks/${task.id}/audit-log`);
    if (res.ok) setAuditLog((await res.json()) as AuditLogEntry[]);
  };

  useEffect(() => {
    const timer = setInterval(() => {
      void refreshPending();
      void refreshAuditLog();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [task.id]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  async function runAgent(promptText: string) {
    if (!promptText.trim() || running) return;
    setRunning(true);
    setLog([]);
    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id, prompt: promptText, agent }),
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
          const event = JSON.parse(line.slice(5).trim()) as OpencodeEvent;
          const described = describeEvent(event);
          if (described) setLog((prev) => [...prev, described]);
          if (event.type === "permission.asked" || event.type === "permission.replied") {
            void refreshPending();
          }
        }
      }
    } catch (err) {
      setLog((prev) => [
        ...prev,
        { kind: "error", text: err instanceof Error ? err.message : String(err) },
      ]);
    } finally {
      setRunning(false);
      void refreshAuditLog();
    }
  }

  async function decide(permissionId: string, action: "once" | "reject") {
    await fetch(`/api/permissions/${permissionId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    await refreshPending();
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

  return (
    <>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>承認待ちの操作</h3>
        {pending.length === 0 && <p className="muted">承認待ちの操作はありません。</p>}
        {pending.map((p) => (
          <div key={p.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 10 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {p.riskTier && <span className={`badge risk-${p.riskTier}`}>{p.riskTier}</span>}
              <code>{p.toolName}</code>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button onClick={() => void decide(p.id, "once")}>承認</button>
              <button className="danger" onClick={() => void decide(p.id, "reject")}>
                却下
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>エージェントに依頼する</h3>
        <div className="field">
          <label htmlFor="agent-select">エージェント</label>
          <select
            id="agent-select"
            value={agent}
            onChange={(e) => setAgent(e.target.value as "investigator" | "operator")}
            disabled={running}
          >
            <option value="investigator">investigator(読み取り専用、書き込みは不可)</option>
            <option value="operator">operator(書き込み操作は承認制で実行可)</option>
          </select>
        </div>
        <div className="field">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例: node1のディスク使用率を確認して、原因を調査してほしい"
            disabled={running}
          />
        </div>
        <button disabled={running || !prompt.trim()} onClick={() => void runAgent(prompt)}>
          {running ? "実行中..." : "実行"}
        </button>

        {log.length > 0 && (
          <div className="event-log" style={{ marginTop: 12 }}>
            {log.map((entry, i) => (
              <div className="event-line" key={i}>
                <div className="kind">{entry.kind}</div>
                <div>{entry.text}</div>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>承認履歴</h3>
        {auditLog.length === 0 && <p className="muted">まだ記録がありません。</p>}
        {auditLog.map((entry) => (
          <div key={entry.id} style={{ marginBottom: 10, fontSize: 13 }}>
            <span className="muted">{new Date(entry.decidedAt).toLocaleString("ja-JP")}</span>{" "}
            <code>{entry.toolName}</code>{" "}
            <span className={entry.decision === "approved" ? "badge" : "badge risk-destructive"}>
              {entry.decision}
            </span>
          </div>
        ))}
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
