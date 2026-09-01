import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "pve-agent-console",
  description: "Proxmox VE運用タスクをAIエージェントに任せるコンソール",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <nav className="nav">
          <Link className="brand" href="/">
            pve-agent-console
          </Link>
          <Link href="/">タスク</Link>
          <Link href="/approvals">承認キュー</Link>
        </nav>
        <div className="container">{children}</div>
      </body>
    </html>
  );
}
