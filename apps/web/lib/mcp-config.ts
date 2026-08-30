import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const mcpProxmoxEntry = path.resolve(dirname, "../../mcp-proxmox/dist/server.js");
const mcpTasksEntry = path.resolve(dirname, "../../mcp-tasks/dist/server.js");

export interface McpConfigOptions {
  databasePath: string;
  pve: {
    apiUrl?: string;
    tokenId?: string;
    tokenSecret?: string;
    tlsInsecure?: boolean;
  };
}

/**
 * Claude Code等のCLIに `--mcp-config` で渡すJSON設定を実行時に生成し、一時ファイルとして書き出す。
 * PVEトークンを含むためリポジトリ配下(config/mcp/)ではなくOSの一時ディレクトリに書く
 * (config/mcp/*.example以外をコミットしない方針と同じ理由。docs/architecture.md 参照)。
 *
 * mcpServersのJSONスキーマは `claude --mcp-config <file>` を実際に実行して疎通確認済み。
 */
export function writeMcpConfig(options: McpConfigOptions): string {
  const config = {
    mcpServers: {
      "mcp-tasks": {
        command: process.execPath,
        args: [mcpTasksEntry],
        env: {
          DATABASE_PATH: options.databasePath,
        },
      },
      "mcp-proxmox": {
        command: process.execPath,
        args: [mcpProxmoxEntry],
        env: {
          DATABASE_PATH: options.databasePath,
          ...(options.pve.apiUrl ? { PVE_API_URL: options.pve.apiUrl } : {}),
          ...(options.pve.tokenId ? { PVE_API_TOKEN_ID: options.pve.tokenId } : {}),
          ...(options.pve.tokenSecret ? { PVE_API_TOKEN_SECRET: options.pve.tokenSecret } : {}),
          PVE_API_TLS_INSECURE: options.pve.tlsInsecure ? "true" : "false",
        },
      },
    },
  };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pve-agent-console-mcp-"));
  const configPath = path.join(dir, "mcp-config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  return configPath;
}

export function pveOptionsFromEnv(): McpConfigOptions["pve"] {
  return {
    apiUrl: process.env.PVE_API_URL,
    tokenId: process.env.PVE_API_TOKEN_ID,
    tokenSecret: process.env.PVE_API_TOKEN_SECRET,
    tlsInsecure: process.env.PVE_API_TLS_INSECURE === "true",
  };
}
