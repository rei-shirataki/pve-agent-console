import type { AgentAdapter, AgentProviderId } from "./types.js";
import { ClaudeCodeAdapter } from "./claude-code-adapter.js";
import { GeminiCliAdapter } from "./gemini-cli-adapter.js";
import { CodexCliAdapter } from "./codex-cli-adapter.js";

const ALL_ADAPTERS: readonly AgentAdapter[] = [
  new ClaudeCodeAdapter(),
  new GeminiCliAdapter(),
  new CodexCliAdapter(),
];

/**
 * ENABLED_AI_PROVIDERS(オプトイン設定)で有効化されたプロバイダーのみを
 * 保持するレジストリを作る。無効化されたプロバイダーはgetで例外になる。
 */
export function createAdapterRegistry(enabledProviders: readonly AgentProviderId[]) {
  const enabled = new Set<AgentProviderId>(enabledProviders);
  const adapters = new Map<AgentProviderId, AgentAdapter>(
    ALL_ADAPTERS.filter((adapter) => enabled.has(adapter.id)).map((adapter) => [
      adapter.id,
      adapter,
    ]),
  );

  return {
    get(id: AgentProviderId): AgentAdapter {
      const adapter = adapters.get(id);
      if (!adapter) {
        throw new Error(
          `AIプロバイダー "${id}" は有効化されていません(ENABLED_AI_PROVIDERSを確認してください)`,
        );
      }
      return adapter;
    },
    list(): AgentAdapter[] {
      return [...adapters.values()];
    },
  };
}
