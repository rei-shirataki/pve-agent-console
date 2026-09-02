import { TaskRepository } from "@pve-agent-console/db";
import { getDb } from "@/lib/db";
import { getOpencodeClient } from "@/lib/opencode-client";
import { listPermissions } from "@/lib/opencode-permissions";
import Sidebar from "@/components/Sidebar";

/**
 * サイドバー(タスク一覧+承認キュー件数+ログアウト)を持つ「認証後のアプリ本体」向けレイアウト。
 * /login はこのグループの外に置き、ルートレイアウト(html/body/フォントのみ)を直接使うことで
 * 未認証の状態でタスク一覧やログアウトボタンが見えてしまう問題を避ける。
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const taskRepo = new TaskRepository(getDb());
  const tasks = taskRepo.listTasks();

  let pendingCount = 0;
  try {
    const { baseUrl } = await getOpencodeClient();
    pendingCount = (await listPermissions(baseUrl)).length;
  } catch {
    // opencode起動直後などで取得できない場合は0のままにし、クライアント側のポーリングに任せる
  }

  return (
    <div className="app-shell">
      <Sidebar initialTasks={tasks} initialPendingCount={pendingCount} />
      <main className="app-main">{children}</main>
    </div>
  );
}
