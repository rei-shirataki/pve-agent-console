import type { AuditLogEntry, TaskComment } from "@pve-agent-console/shared-types";

export type ChatEntry =
  | { kind: "user-text"; id: string; text: string; at: string }
  | { kind: "agent-text"; id: string; text: string; at: string }
  | { kind: "agent-reasoning"; id: string; text: string; at: string }
  | {
      kind: "tool-call";
      id: string;
      tool: string;
      status: string;
      input?: unknown;
      output?: unknown;
      at: string;
    }
  | {
      kind: "permission";
      id: string;
      tool: string;
      status: "pending" | "approved" | "rejected";
      at: string;
    }
  | { kind: "comment"; id: string; author: "user" | "agent"; text: string; at: string };

interface OpencodeMessagePart {
  id?: string;
  type?: string;
  text?: string;
  tool?: string;
  callID?: string;
  state?: { status?: string; input?: unknown; output?: unknown };
}

interface OpencodeMessage {
  info: { id: string; role: "user" | "assistant"; time: { created: number } };
  parts: OpencodeMessagePart[];
}

/**
 * opencodeの `session.messages()` レスポンス(過去の会話履歴)をChatEntry[]へ変換する。
 * ページ初回表示時、SSEで受け取るライブイベントと同じ見た目で描画するために使う。
 *
 * SDKの生成型(Part型のunion)はメッセージ種別ごとに`time`の形が異なり複雑なため、
 * ここでは構造的に緩い型で受け取り、実行時に必要なフィールドの有無だけを確認する
 * (docs/migration-plan.md Phase 0で確認済みの通り、SDKの型は当てにしすぎない方針)。
 */
export function messagesToChatEntries(messages: readonly unknown[]): ChatEntry[] {
  const entries: ChatEntry[] = [];
  for (const raw of messages) {
    const message = raw as OpencodeMessage;
    const at = new Date(message.info.time.created).toISOString();
    for (const part of message.parts) {
      if (part.type === "text" && part.text) {
        entries.push({
          kind: message.info.role === "user" ? "user-text" : "agent-text",
          id: part.id ?? `${message.info.id}-text`,
          text: part.text,
          at,
        });
      } else if (part.type === "reasoning" && part.text) {
        entries.push({
          kind: "agent-reasoning",
          id: part.id ?? `${message.info.id}-reasoning`,
          text: part.text,
          at,
        });
      } else if (part.type === "tool" && part.tool) {
        entries.push({
          kind: "tool-call",
          id: part.id ?? `${message.info.id}-${part.callID ?? "tool"}`,
          tool: part.tool,
          status: part.state?.status ?? "pending",
          input: part.state?.input,
          output: part.state?.output,
          at,
        });
      }
    }
  }
  return entries;
}

/** タスクの監査ログ(過去の承認決定)をChatEntry[]へ変換する。 */
export function auditLogToChatEntries(entries: AuditLogEntry[]): ChatEntry[] {
  return entries.map((entry) => ({
    kind: "permission" as const,
    id: entry.id,
    tool: entry.toolName,
    status: entry.decision,
    at: entry.decidedAt,
  }));
}

/** タスクのコメントをChatEntry[]へ変換する。 */
export function commentsToChatEntries(comments: TaskComment[]): ChatEntry[] {
  return comments.map((c) => ({
    kind: "comment" as const,
    id: c.id,
    author: c.author,
    text: c.body,
    at: c.createdAt,
  }));
}
