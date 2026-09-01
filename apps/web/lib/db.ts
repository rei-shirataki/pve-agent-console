import { createDb, type Db } from "@pve-agent-console/db";

let dbInstance: Db | undefined;

/**
 * apps/web自身(BFF)がタスク一覧表示・承認キュー表示・承認/却下の書き込みのために
 * 直接参照するDB接続。mcp-tasks/mcp-proxmoxとは別プロセスから同じSQLiteファイルを
 * WALモードで参照する(docs/architecture.md 参照)。
 */
export function getDb(): Db {
  dbInstance ??= createDb(process.env.DATABASE_PATH ?? "./data/pve-agent-console.db");
  return dbInstance;
}
