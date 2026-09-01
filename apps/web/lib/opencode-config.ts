import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const mcpProxmoxEntry = path.resolve(dirname, "../../mcp-proxmox/dist/server.js");
const mcpTasksEntry = path.resolve(dirname, "../../mcp-tasks/dist/server.js");

export interface OpencodeConfigOptions {
  pve: {
    apiUrl?: string;
    tokenId?: string;
    tokenSecret?: string;
    tlsInsecure?: boolean;
  };
}

/**
 * opencode serveの起動ディレクトリ(cwd)に置くopencode.jsonを生成する。
 * opencodeはこのファイルを`--config`のようなフラグではなくcwd起点で自動検出する
 * (`opencode mcp list`/`opencode serve`実行時にcwdの opencode.json が読み込まれることを実機確認済み。
 * docs/migration-plan.md Phase 0参照)。
 *
 * PVEトークンを含むため、config/mcp/*.example以外をコミットしない方針と同じ理由で
 * リポジトリ外の一時ディレクトリに書く。
 */
export function writeOpencodeConfig(options: OpencodeConfigOptions): string {
  const mcpProxmoxEnv: Record<string, string> = {
    PVE_API_TLS_INSECURE: options.pve.tlsInsecure ? "true" : "false",
  };
  if (options.pve.apiUrl) mcpProxmoxEnv.PVE_API_URL = options.pve.apiUrl;
  if (options.pve.tokenId) mcpProxmoxEnv.PVE_API_TOKEN_ID = options.pve.tokenId;
  if (options.pve.tokenSecret) mcpProxmoxEnv.PVE_API_TOKEN_SECRET = options.pve.tokenSecret;

  const config = {
    $schema: "https://opencode.ai/config.json",
    mcp: {
      "mcp-proxmox": {
        type: "local",
        command: [process.execPath, mcpProxmoxEntry],
        enabled: true,
        environment: mcpProxmoxEnv,
      },
      "mcp-tasks": {
        type: "local",
        command: [process.execPath, mcpTasksEntry],
        enabled: true,
        environment: {
          DATABASE_PATH: process.env.DATABASE_PATH ?? "./data/pve-agent-console.db",
        },
      },
    },
    // 組み込みツール(bash/edit/write/read)は全てdenyし、MCPツールのみに用途を限定する
    // (CLAUDE.md「絶対に守る設計原則」6番、docs/adr/0001-adopt-opencode.md参照)
    tools: {
      bash: false,
      edit: false,
      write: false,
      read: false,
    },
    permission: {
      // fail-closed: 未知のツールは拒否(旧設計のrisk tier fail-closed原則を踏襲)
      "*": "deny",
      "mcp-proxmox_pve_get_*": "allow",
      "mcp-proxmox_pve_list_*": "allow",
      "mcp-proxmox_pve_vm_start": "ask",
      "mcp-proxmox_pve_vm_shutdown": "ask",
      "mcp-proxmox_pve_vm_stop": "ask",
      "mcp-proxmox_pve_vm_delete": "ask",
      "mcp-tasks_*": "allow",
    },
    agent: {
      // 読み取りのみタスク用: write/destructiveはaskではなくdenyにして物理的に実行不能にする
      investigator: {
        permission: {
          "mcp-proxmox_pve_vm_*": "deny",
        },
      },
      // 書き込みを伴うタスク用: グローバル設定(write/destructiveはask)をそのまま使う
      operator: {},
    },
  };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pve-agent-console-opencode-"));
  fs.writeFileSync(path.join(dir, "opencode.json"), JSON.stringify(config, null, 2), "utf-8");
  return dir;
}

// mcp-proxmoxのwrite/destructiveツール名(このファイルで生成するpermission設定と対応)。
// audit_log記録時にriskTierを解決する根拠として使う。ツールを追加した場合はここも更新する。
const WRITE_TOOLS = new Set([
  "mcp-proxmox_pve_vm_start",
  "mcp-proxmox_pve_vm_shutdown",
  "mcp-proxmox_pve_vm_stop",
]);
const DESTRUCTIVE_TOOLS = new Set(["mcp-proxmox_pve_vm_delete"]);

export function resolveRiskTier(toolName: string): "write" | "destructive" | null {
  if (DESTRUCTIVE_TOOLS.has(toolName)) return "destructive";
  if (WRITE_TOOLS.has(toolName)) return "write";
  return null;
}

export function pveOptionsFromEnv(): OpencodeConfigOptions["pve"] {
  return {
    apiUrl: process.env.PVE_API_URL,
    tokenId: process.env.PVE_API_TOKEN_ID,
    tokenSecret: process.env.PVE_API_TOKEN_SECRET,
    tlsInsecure: process.env.PVE_API_TLS_INSECURE === "true",
  };
}
