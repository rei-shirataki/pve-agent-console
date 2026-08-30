import { spawn } from "node:child_process";
import type { AgentEvent } from "@pve-agent-console/shared-types";
import type { AgentAdapter, AgentRunInput } from "./types.js";

/**
 * Gemini CLI用アダプター(未実装)。
 *
 * この開発ホストにGemini CLIが未インストールのため、非対話モードの具体的な
 * フラグ・MCP設定ファイル形式・stream出力スキーマを検証できていない。
 * ClaudeCodeAdapterと同様に「実CLIの--helpと実出力で確認してから実装する」方針
 * (docs/architecture.md 7節)のため、ここでは未実装として明示的にエラーを返す。
 *
 * isAvailable()はCLIバイナリの有無だけ判定し、trueであっても run() はまだ使えない。
 */
export class GeminiCliAdapter implements AgentAdapter {
  readonly id = "gemini-cli" as const;

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn("gemini", ["--version"], { stdio: "ignore" });
      child.on("error", () => resolve(false));
      child.on("exit", (code) => resolve(code === 0));
    });
  }

  run(_input: AgentRunInput): AsyncIterable<AgentEvent> {
    throw new Error(
      "GeminiCliAdapter は未実装です。gemini CLIをインストールし、--helpと実際の非対話モード出力を確認してから実装してください(docs/architecture.md 7節)。",
    );
  }
}
