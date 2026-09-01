"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TaskType, TaskPriority } from "@pve-agent-console/shared-types";
import { TASK_TYPE_LABELS, TASK_PRIORITY_LABELS } from "@/lib/labels";

const TYPE_OPTIONS: TaskType[] = ["incident", "change", "maintenance", "other"];
const PRIORITY_OPTIONS: TaskPriority[] = ["low", "medium", "high", "critical"];

export default function CreateTaskForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<TaskType>("other");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, type, priority, origin: "user" }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `request failed: ${res.status}`);
      }
      const task = (await res.json()) as { id: string };
      setTitle("");
      setDescription("");
      router.push(`/tasks/${task.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={(e) => void onSubmit(e)}>
      <div className="field">
        <label htmlFor="title">タイトル</label>
        <input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: node1のディスク使用率が高い"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="description">詳細</label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="状況・背景など"
        />
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="type">種類</label>
          <select id="type" value={type} onChange={(e) => setType(e.target.value as TaskType)}>
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {TASK_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="priority">優先度</label>
          <select
            id="priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {TASK_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? "作成中..." : "作成"}
      </button>
    </form>
  );
}
