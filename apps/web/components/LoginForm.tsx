"use client";

import { useState, type FormEvent } from "react";

export default function LoginForm({ next }: { next?: string }) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "ログインに失敗しました");
        return;
      }
      window.location.href = next && next.startsWith("/") ? next : "/";
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="login-form">
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="パスワード"
        autoFocus
      />
      {error && <p className="login-error">{error}</p>}
      <button type="submit" disabled={submitting || !password}>
        {submitting ? "ログイン中..." : "ログイン"}
      </button>
    </form>
  );
}
