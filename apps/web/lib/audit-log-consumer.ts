import type { AuditLogRepository, TaskRepository } from "@pve-agent-console/db";
import { resolveRiskTier } from "./opencode-config";

/**
 * Next.jsのインストルメンテーションフック。サーバープロセス起動時に一度だけ呼ばれる。
 * ここで opencode serve を子プロセスとして起動し、permission関連イベントを
 * audit_log に記録するバックグラウンド購読を開始する(docs/migration-plan.md Phase 3)。
 *
 * `@opencode-ai/sdk`(1.18.25)が生成した型定義には permission.asked イベントが含まれておらず、
 * permission.replied の型も実際のプロパティ名(requestID/reply)と一致しない
 * (型は permissionID/response と定義されているが、実機では requestID/reply が返ってくる。
 * docs/migration-plan.md Phase 0で確認済み)。そのためここでは型定義を信用せず、
 * 実機で確認した実際のペイロード形状に基づいた手書きの型を使う。
 */

interface PermissionAskedProperties {
  id: string;
  sessionID: string;
  permission: string;
  tool: { messageID: string; callID: string };
}

interface PermissionRepliedProperties {
  sessionID: string;
  requestID: string;
  reply: "once" | "always" | "reject";
}

interface ToolPartUpdatedProperties {
  part?: {
    type?: string;
    callID?: string;
    state?: { status?: string; input?: unknown };
  };
}

interface EventStreamClient {
  event: {
    subscribe: () => Promise<{ stream: AsyncIterable<{ type: string; properties: unknown }> }>;
  };
}

export function startAuditLogConsumer(
  client: EventStreamClient,
  auditRepo: AuditLogRepository,
  taskRepo: TaskRepository,
): void {
  const pendingAsks = new Map<
    string,
    { toolName: string; sessionId: string; askedAt: string; callId: string }
  >();
  const toolInputs = new Map<string, unknown>();

  void (async () => {
    try {
      const events = await client.event.subscribe();
      for await (const event of events.stream) {
        const type = event.type;
        const properties = event.properties;

        if (type === "permission.asked") {
          const p = properties as PermissionAskedProperties;
          pendingAsks.set(p.id, {
            toolName: p.permission,
            sessionId: p.sessionID,
            askedAt: new Date().toISOString(),
            callId: p.tool.callID,
          });
          continue;
        }

        if (type === "message.part.updated") {
          const p = properties as ToolPartUpdatedProperties;
          if (p.part?.type === "tool" && p.part.callID && p.part.state?.status === "running") {
            toolInputs.set(p.part.callID, p.part.state.input);
          }
          continue;
        }

        if (type === "permission.replied") {
          const p = properties as PermissionRepliedProperties;
          const asked = pendingAsks.get(p.requestID);
          pendingAsks.delete(p.requestID);

          // 削除前に読み取ること(先にdeleteすると常にundefinedになる、という
          // 実機テストで踏んだ順序ミスがあった。docs/migration-plan.md Phase 5参照)
          const args = asked ? (toolInputs.get(asked.callId) ?? null) : null;
          if (asked) toolInputs.delete(asked.callId);

          const task = taskRepo.getTaskByOpencodeSessionId(p.sessionID);

          // record()はreply APIハンドラが既に行に書き込んでいればonConflictDoNothingでno-op、
          // 未経由(UIを介さないreply等)ならここがfull writeになる。いずれの場合も
          // applyCorrections()でarguments/askedAtをこのプロセスが知る正確な値に補正する
          // (Next.jsの複数ワーカー間でモジュール状態が共有されないため、DBの行を介して
          // 2箇所の書き込みを合成する設計にしている。docs/architecture.md参照)。
          auditRepo.record({
            id: p.requestID,
            sessionId: p.sessionID,
            taskId: task?.id ?? null,
            toolName: asked?.toolName ?? "unknown",
            arguments: (args as Record<string, unknown> | null) ?? null,
            riskTier: asked ? resolveRiskTier(asked.toolName) : null,
            decision: p.reply === "reject" ? "rejected" : "approved",
            decidedBy: null,
            askedAt: asked?.askedAt ?? new Date().toISOString(),
            decidedAt: new Date().toISOString(),
          });
          // askedを持たない場合(このワーカーがpermission.askedを取り損ねた等)にnullで
          // 上書きしないよう、正しい値を持っている時だけ補正する
          if (asked) {
            auditRepo.applyCorrections(p.requestID, (args as Record<string, unknown> | null) ?? null, asked.askedAt);
          }
        }
      }
    } catch (err) {
      console.error("[audit-log] opencode event subscription failed:", err);
    }
  })();
}
