import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { TaskRepository } from "@pve-agent-console/db";
import { getDb } from "@/lib/db";
import { getOpencodeClient } from "@/lib/opencode-client";
import { listPermissions } from "@/lib/opencode-permissions";
import Sidebar from "@/components/Sidebar";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap" });

// ルートレイアウトがDB/opencodeへ直接アクセスするため、ビルド時の静的プリレンダリング
// (/_not-foundを含む)がDB未接続の状態で実行されて失敗する。このアプリに静的化できる
// ページは無いため、明示的に全ページを動的レンダリングにする。
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "pve-agent-console",
  description: "Proxmox VE運用タスクをAIエージェントに任せるコンソール",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
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
    <html lang="ja">
      <body className={inter.className}>
        <div className="app-shell">
          <Sidebar initialTasks={tasks} initialPendingCount={pendingCount} />
          <main className="app-main">{children}</main>
        </div>
      </body>
    </html>
  );
}
