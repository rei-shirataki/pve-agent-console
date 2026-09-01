import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { RiskTier } from "@pve-agent-console/shared-types";
import { createPveClientFromEnv } from "./pve-client.js";

const pve = createPveClientFromEnv();

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/**
 * PVE操作ツールの定義。riskTierは必須フィールド(コンパイルエラーで検知でき、
 * オプショナルにして"うっかり省略"できないようにしている。CLAUDE.md「絶対に守る設計原則」参照)。
 *
 * 実行のブロック(write/destructiveの承認待ち)はこのMCPサーバーの責務ではない。
 * opencode側の`permission`設定(ask)がツール呼び出し自体をブロック・再開するため、
 * ここに来た時点で承認判定は既に完了している。riskTierはopencodeのpermission設定を
 * 生成する根拠、およびUI上のバッジ表示の強度として使うメタデータに過ぎない
 * (docs/adr/0001-adopt-opencode.md参照)。
 */
interface PveToolDef {
  name: string;
  title: string;
  description: string;
  riskTier: RiskTier;
  inputSchema: z.ZodRawShape;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

const vmArgsSchema = { node: z.string(), vmid: z.number().int() };

const toolDefs: PveToolDef[] = [
  // --- read(デフォルト許可) -----------------------------------------
  {
    name: "pve_get_version",
    title: "PVEバージョンを取得",
    description: "Proxmox VE APIの疎通確認を兼ねた、クラスタのバージョン情報取得",
    riskTier: "read",
    inputSchema: {},
    execute: () => pve.getVersion(),
  },
  {
    name: "pve_list_nodes",
    title: "ノード一覧を取得",
    description: "クラスタに参加しているノードの一覧と状態を取得する",
    riskTier: "read",
    inputSchema: {},
    execute: () => pve.listNodes(),
  },
  {
    name: "pve_get_node_status",
    title: "ノードの状態を取得",
    description: "指定ノードのCPU/メモリ/稼働時間などの状態を取得する",
    riskTier: "read",
    inputSchema: { node: z.string() },
    execute: (args) => pve.getNodeStatus(args.node as string),
  },
  {
    name: "pve_list_vms",
    title: "VM一覧を取得",
    description: "指定ノード上のQEMU VM一覧を取得する",
    riskTier: "read",
    inputSchema: { node: z.string() },
    execute: (args) => pve.listVms(args.node as string),
  },
  {
    name: "pve_list_lxc",
    title: "LXC一覧を取得",
    description: "指定ノード上のLXCコンテナ一覧を取得する",
    riskTier: "read",
    inputSchema: { node: z.string() },
    execute: (args) => pve.listLxc(args.node as string),
  },
  // --- write(opencode側でask) ------------------------------------------
  {
    name: "pve_vm_start",
    title: "VMを起動",
    description: "指定VMを起動する",
    riskTier: "write",
    inputSchema: vmArgsSchema,
    execute: (args) => pve.startVm(args.node as string, args.vmid as number),
  },
  {
    name: "pve_vm_shutdown",
    title: "VMをシャットダウン",
    description: "指定VMにACPIシャットダウンを送る",
    riskTier: "write",
    inputSchema: vmArgsSchema,
    execute: (args) => pve.shutdownVm(args.node as string, args.vmid as number),
  },
  {
    name: "pve_vm_stop",
    title: "VMを強制停止",
    description: "指定VMを強制停止する(未保存データが失われる可能性がある)",
    riskTier: "write",
    inputSchema: vmArgsSchema,
    execute: (args) => pve.stopVm(args.node as string, args.vmid as number),
  },
  // --- destructive(opencode側でask。UI側でより強い確認を求める想定) -----
  {
    name: "pve_vm_delete",
    title: "VMを削除",
    description: "指定VMを完全に削除する。取り消せない破壊的操作。",
    riskTier: "destructive",
    inputSchema: vmArgsSchema,
    execute: (args) => pve.deleteVm(args.node as string, args.vmid as number),
  },
];

const server = new McpServer({ name: "pve-agent-console-mcp-proxmox", version: "0.2.0" });

for (const def of toolDefs) {
  server.registerTool(
    def.name,
    {
      title: def.title,
      description: `[risk: ${def.riskTier}] ${def.description}`,
      inputSchema: def.inputSchema,
    },
    async (args: Record<string, unknown>) => {
      try {
        return jsonResult(await def.execute(args));
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
