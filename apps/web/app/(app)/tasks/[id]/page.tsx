import { notFound } from "next/navigation";
import { TaskRepository, AuditLogRepository } from "@pve-agent-console/db";
import { getDb } from "@/lib/db";
import { getOpencodeClient } from "@/lib/opencode-client";
import { listPermissions } from "@/lib/opencode-permissions";
import { resolveRiskTier } from "@/lib/opencode-config";
import {
  messagesToChatEntries,
  auditLogToChatEntries,
  commentsToChatEntries,
  type ChatEntry,
} from "@/lib/chat-entries";
import TaskChatView from "@/components/TaskChatView";

export const dynamic = "force-dynamic";

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const taskRepo = new TaskRepository(getDb());
  const auditRepo = new AuditLogRepository(getDb());

  const task = taskRepo.getTask(id);
  if (!task) notFound();
  const comments = taskRepo.listComments(id);
  const auditLog = auditRepo.listByTask(id);

  let history: ChatEntry[] = [...auditLogToChatEntries(auditLog), ...commentsToChatEntries(comments)];
  let pendingPermissions: { id: string; toolName: string; riskTier: "write" | "destructive" | null }[] = [];

  try {
    const { client, baseUrl } = await getOpencodeClient();
    if (task.opencodeSessionId) {
      const messages = await client.session.messages({ path: { id: task.opencodeSessionId } });
      if (messages.data) {
        history = [...history, ...messagesToChatEntries(messages.data)];
      }
    }
    const all = await listPermissions(baseUrl);
    pendingPermissions = all
      .filter((p) => p.sessionID === task.opencodeSessionId)
      .map((p) => ({ id: p.id, toolName: p.permission, riskTier: resolveRiskTier(p.permission) }));
  } catch {
    // opencode server起動直後などで取得できない場合は空のまま表示し、クライアント側の操作に任せる
  }

  history.sort((a, b) => a.at.localeCompare(b.at));

  // 現在保留中の承認は、対応するtool-callパートの履歴を厳密に相関させる代わりに、
  // 末尾に「今まさに保留中」のカードとして追加する(承認待ち中にページを再読み込みしても
  // 承認/却下ボタンが出るようにするため。docs/architecture.md参照)。
  const now = new Date().toISOString();
  for (const p of pendingPermissions) {
    history.push({ kind: "permission", id: p.id, tool: p.toolName, status: "pending", at: now });
  }

  return <TaskChatView task={task} initialHistory={history} />;
}
