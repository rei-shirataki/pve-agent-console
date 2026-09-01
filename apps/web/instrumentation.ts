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

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getOpencodeClient } = await import("./lib/opencode-client");
  const { getDb } = await import("./lib/db");
  const { AuditLogRepository, TaskRepository } = await import("@pve-agent-console/db");
  const { resolveRiskTier } = await import("./lib/opencode-config");

  const { client } = await getOpencodeClient();
  const auditRepo = new AuditLogRepository(getDb());
  const taskRepo = new TaskRepository(getDb());

  const pendingAsks = new Map<
    string,
    { toolName: string; sessionId: string; askedAt: string; callId: string }
  >();
  const toolInputs = new Map<string, unknown>();

  void (async () => {
    try {
      const events = await client.event.subscribe();
      for await (const event of events.stream) {
        const type = (event as { type: string }).type;
        const properties = (event as { properties: unknown }).properties;

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
          if (asked) toolInputs.delete(asked.callId);

          const task = taskRepo.getTaskByOpencodeSessionId(p.sessionID);
          const args = asked ? (toolInputs.get(asked.callId) ?? null) : null;

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
        }
      }
    } catch (err) {
      console.error("[audit-log] opencode event subscription failed:", err);
    }
  })();
}
