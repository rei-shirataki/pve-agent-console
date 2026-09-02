import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap" });

// このアプリに静的化できるページは無いため、明示的に全ページを動的レンダリングにする
// (/_not-foundを含む自動生成ルートがビルド時に静的プリレンダリングされてDB未接続で失敗するのを防ぐ)。
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "pve-agent-console",
  description: "Proxmox VE運用タスクをAIエージェントに任せるコンソール",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
