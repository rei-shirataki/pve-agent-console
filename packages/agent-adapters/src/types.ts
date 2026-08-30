import type { AgentEvent } from "@pve-agent-console/shared-types";

export type AgentProviderId = "claude-code" | "gemini-cli" | "codex-cli";

export interface AgentRunInput {
  taskId: string;
  prompt: string;
  /** stdio MCPサーバー(mcp-proxmox / mcp-tasks)を指す設定ファイルのパス */
  mcpConfigPath: string;
  /** 承認待ちからの再開時に、直前のセッションIDを渡す */
  resumeSessionId?: string;
}

export interface AgentAdapter {
  readonly id: AgentProviderId;
  isAvailable(): Promise<boolean>;
  run(input: AgentRunInput): AsyncIterable<AgentEvent>;
}
