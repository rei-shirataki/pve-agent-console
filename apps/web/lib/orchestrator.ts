import type { AgentEvent } from "@pve-agent-console/shared-types";
import { createAdapterRegistry, type AgentProviderId } from "@pve-agent-console/agent-adapters";
import { writeMcpConfig, pveOptionsFromEnv } from "./mcp-config";

const KNOWN_PROVIDER_IDS: readonly AgentProviderId[] = ["claude-code", "gemini-cli", "codex-cli"];

function parseEnabledProviders(): AgentProviderId[] {
  const raw = process.env.ENABLED_AI_PROVIDERS ?? "claude-code";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((id): id is AgentProviderId => (KNOWN_PROVIDER_IDS as readonly string[]).includes(id));
}

const registry = createAdapterRegistry(parseEnabledProviders());

export function defaultProviderId(): AgentProviderId {
  const configured = process.env.DEFAULT_AI_PROVIDER;
  return configured && (KNOWN_PROVIDER_IDS as readonly string[]).includes(configured)
    ? (configured as AgentProviderId)
    : "claude-code";
}

export interface RunAgentInput {
  taskId: string;
  prompt: string;
  providerId?: AgentProviderId;
  resumeSessionId?: string;
}

/**
 * タスクに対してAIエージェントを1回実行する。mcp-proxmox/mcp-tasksへのstdio接続情報を
 * 都度生成し(lib/mcp-config.ts)、選択されたプロバイダーのアダプターへ委譲する。
 */
export function runAgent(input: RunAgentInput): AsyncIterable<AgentEvent> {
  const adapter = registry.get(input.providerId ?? defaultProviderId());
  const mcpConfigPath = writeMcpConfig({
    databasePath: process.env.DATABASE_PATH ?? "./data/pve-agent-console.db",
    pve: pveOptionsFromEnv(),
  });

  return adapter.run({
    taskId: input.taskId,
    prompt: input.prompt,
    mcpConfigPath,
    resumeSessionId: input.resumeSessionId,
  });
}
