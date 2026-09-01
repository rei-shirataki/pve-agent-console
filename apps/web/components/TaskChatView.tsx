"use client";

import { useEffect, useRef, useState } from "react";
import type { Task } from "@pve-agent-console/shared-types";
import type { ChatEntry } from "@/lib/chat-entries";
import { TASK_TYPE_LABELS, TASK_STATUS_LABELS, TASK_PRIORITY_LABELS } from "@/lib/labels";

interface Props {
  task: Task;
  initialHistory: ChatEntry[];
}

interface RawEvent {
  type: string;
  properties?: Record<string, unknown>;
}

function upsert(entries: ChatEntry[], next: ChatEntry): ChatEntry[] {
  const idx = entries.findIndex((e) => e.id === next.id && e.kind === next.kind);
  if (idx === -1) return [...entries, next];
  const copy = entries.slice();
  copy[idx] = next;
  return copy;
}

function applyEvent(
  entries: ChatEntry[],
  event: RawEvent,
  messageRoles: Map<string, "user" | "assistant">,
): ChatEntry[] {
  const props = event.properties ?? {};

  if (event.type === "message.updated") {
    const info = props.info as { id?: string; role?: "user" | "assistant" } | undefined;
    if (info?.id && info.role) messageRoles.set(info.id, info.role);
    return entries;
  }

  if (event.type === "message.part.updated") {
    const part = props.part as
      | {
          id?: string;
          type?: string;
          text?: string;
          tool?: string;
          messageID?: string;
          time?: { start?: number };
          state?: { status?: string; input?: unknown; output?: unknown };
        }
      | undefined;
    if (!part?.id) return entries;
    const at = part.time?.start ? new Date(part.time.start).toISOString() : new Date().toISOString();
    const role = part.messageID ? messageRoles.get(part.messageID) : undefined;

    if (part.type === "text" && typeof part.text === "string") {
      return upsert(entries, {
        kind: role === "user" ? "user-text" : "agent-text",
        id: part.id,
        text: part.text,
        at,
      });
    }
    if (part.type === "reasoning" && typeof part.text === "string") {
      return upsert(entries, { kind: "agent-reasoning", id: part.id, text: part.text, at });
    }
    if (part.type === "tool" && typeof part.tool === "string") {
      return upsert(entries, {
        kind: "tool-call",
        id: part.id,
        tool: part.tool,
        status: part.state?.status ?? "pending",
        input: part.state?.input,
        output: part.state?.output,
        at,
      });
    }
    return entries;
  }

  if (event.type === "permission.asked") {
    const id = props.id as string | undefined;
    const permission = props.permission as string | undefined;
    if (!id || !permission) return entries;
    return upsert(entries, { kind: "permission", id, tool: permission, status: "pending", at: new Date().toISOString() });
  }

  if (event.type === "permission.replied") {
    const requestId = props.requestID as string | undefined;
    const reply = props.reply as string | undefined;
    if (!requestId) return entries;
    return entries.map((e) =>
      e.kind === "permission" && e.id === requestId
        ? { ...e, status: reply === "reject" ? "rejected" : "approved" }
        : e,
    );
  }

  return entries;
}

function ToolCallCard({ entry }: { entry: Extract<ChatEntry, { kind: "tool-call" }> }) {
  const isError = entry.status === "error";
  return (
    <div className={`chat-card${isError ? " tool-error" : ""}`}>
      <div className="kind">tool</div>
      <code>
        🔧 {entry.tool} [{entry.status}]
      </code>
      {entry.input !== undefined && <pre>入力: {JSON.stringify(entry.input)}</pre>}
      {entry.output !== undefined && <pre>結果: {JSON.stringify(entry.output)}</pre>}
    </div>
  );
}

function PermissionCard({
  entry,
  onDecide,
}: {
  entry: Extract<ChatEntry, { kind: "permission" }>;
  onDecide: (id: string, action: "once" | "reject") => void;
}) {
  const decided = entry.status !== "pending";
  return (
    <div className={`chat-card permission${decided ? " decided" : ""}`}>
      <div className="kind">permission</div>
      <code>{entry.tool}</code>
      {entry.status === "pending" && (
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={() => onDecide(entry.id, "once")}>承認</button>
          <button className="danger" onClick={() => onDecide(entry.id, "reject")}>
            却下
          </button>
        </div>
      )}
      {entry.status === "approved" && <p className="muted" style={{ margin: "6px 0 0" }}>✅ 承認済み</p>}
      {entry.status === "rejected" && <p className="muted" style={{ margin: "6px 0 0" }}>❌ 却下</p>}
    </div>
  );
}

export default function TaskChatView({ task, initialHistory }: Props) {
  const [history, setHistory] = useState(initialHistory);
  const [prompt, setPrompt] = useState("");
  const [agent, setAgent] = useState<"investigator" | "operator">(
    task.type === "incident" ? "investigator" : "operator",
  );
  const [running, setRunning] = useState(false);

  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const messageRolesRef = useRef(new Map<string, "user" | "assistant">());

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  // ページを開いたまま放置していても、他クライアントでの承認決定が反映されるようにポーリングする
  useEffect(() => {
    const timer = setInterval(() => {
      fetch(`/api/permissions?taskId=${task.id}`)
        .then((res) => (res.ok ? (res.json() as Promise<{ id: string }[]>) : null))
        .then((data) => {
          if (!data) return;
          const stillPendingIds = new Set(data.map((p) => p.id));
          setHistory((prev) =>
            prev.map((e) =>
              e.kind === "permission" && e.status === "pending" && !stillPendingIds.has(e.id)
                ? { ...e, status: "approved" }
                : e,
            ),
          );
        })
        .catch(() => {
          /* ポーリング失敗は無視して次回再試行 */
        });
    }, 5000);
    return () => clearInterval(timer);
  }, [task.id]);

  async function runAgent(promptText: string) {
    if (!promptText.trim() || running) return;
    setRunning(true);
    setPrompt("");
    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id, prompt: promptText, agent }),
      });
      if (!res.ok || !res.body) throw new Error(`agent run failed to start: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith("data:")) continue;
          const event = JSON.parse(line.slice(5).trim()) as RawEvent;
          setHistory((prev) => applyEvent(prev, event, messageRolesRef.current));
        }
      }
    } catch (err) {
      setHistory((prev) => [
        ...prev,
        {
          kind: "comment",
          id: `error-${Date.now()}`,
          author: "agent",
          text: `⚠ ${err instanceof Error ? err.message : String(err)}`,
          at: new Date().toISOString(),
        },
      ]);
    } finally {
      setRunning(false);
    }
  }

  async function decide(permissionId: string, action: "once" | "reject") {
    setHistory((prev) =>
      prev.map((e) =>
        e.kind === "permission" && e.id === permissionId
          ? { ...e, status: action === "reject" ? "rejected" : "approved" }
          : e,
      ),
    );
    await fetch(`/api/permissions/${permissionId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
  }

  return (
    <>
      <div className="chat-header">
        <h1>{task.title}</h1>
        <div className="badges">
          <span className={`badge type-${task.type}`}>{TASK_TYPE_LABELS[task.type]}</span>
          <span className="badge">{TASK_STATUS_LABELS[task.status]}</span>
          <span className="badge">優先度: {TASK_PRIORITY_LABELS[task.priority]}</span>
          {task.origin === "agent" && <span className="badge">エージェント起票</span>}
        </div>
      </div>

      <div className="chat-thread">
        {task.description && (
          <div className="chat-entry">
            <div className="chat-bubble comment">{task.description}</div>
          </div>
        )}

        {history.length === 0 && !task.description && (
          <p className="muted">まだ会話はありません。下から話しかけてみてください。</p>
        )}

        {history.map((entry) => {
          switch (entry.kind) {
            case "user-text":
              return (
                <div className="chat-entry" key={entry.id}>
                  <div className="chat-bubble user">{entry.text}</div>
                </div>
              );
            case "agent-text":
              return (
                <div className="chat-entry" key={entry.id}>
                  <div className="chat-bubble agent-text">{entry.text}</div>
                </div>
              );
            case "agent-reasoning":
              return (
                <div className="chat-entry" key={entry.id}>
                  <div className="chat-bubble agent-reasoning">{entry.text}</div>
                </div>
              );
            case "tool-call":
              return (
                <div className="chat-entry" key={entry.id}>
                  <ToolCallCard entry={entry} />
                </div>
              );
            case "permission":
              return (
                <div className="chat-entry" key={entry.id}>
                  <PermissionCard entry={entry} onDecide={(id, action) => void decide(id, action)} />
                </div>
              );
            case "comment":
              return (
                <div className="chat-entry" key={entry.id}>
                  <div className="chat-bubble comment">
                    <span className="muted" style={{ fontSize: 11 }}>
                      {entry.author === "user" ? "メモ" : "system"} ·{" "}
                      {new Date(entry.at).toLocaleString("ja-JP")}
                    </span>
                    <div>{entry.text}</div>
                  </div>
                </div>
              );
          }
        })}
        <div ref={threadEndRef} />
      </div>

      <div className="composer">
        <div className="composer-inner">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例: node1のディスク使用率を確認して、原因を調査してほしい"
            disabled={running}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void runAgent(prompt);
              }
            }}
          />
          <div className="composer-controls">
            <select value={agent} onChange={(e) => setAgent(e.target.value as "investigator" | "operator")}>
              <option value="investigator">investigator(読み取り専用)</option>
              <option value="operator">operator(書き込み可・承認制)</option>
            </select>
            <button disabled={running || !prompt.trim()} onClick={() => void runAgent(prompt)}>
              {running ? "実行中..." : "送信"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
