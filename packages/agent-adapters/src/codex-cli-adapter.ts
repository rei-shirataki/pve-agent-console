import { spawn } from "node:child_process";
import type { AgentEvent } from "@pve-agent-console/shared-types";
import type { AgentAdapter, AgentRunInput } from "./types.js";

/**
 * Codex CLI用アダプター(未実装)。
 * GeminiCliAdapterと同様の理由で未実装(docs/architecture.md 7節)。
 * `codex exec` 相当の非対話モードのフラグ・MCP設定形式は実装時に要検証。
 */
export class CodexCliAdapter implements AgentAdapter {
  readonly id = "codex-cli" as const;

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn("codex", ["--version"], { stdio: "ignore" });
      child.on("error", () => resolve(false));
      child.on("exit", (code) => resolve(code === 0));
    });
  }

  run(_input: AgentRunInput): AsyncIterable<AgentEvent> {
    throw new Error(
      "CodexCliAdapter は未実装です。codex CLIをインストールし、--helpと実際の非対話モード出力を確認してから実装してください(docs/architecture.md 7節)。",
    );
  }
}
