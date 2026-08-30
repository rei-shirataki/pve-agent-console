import { spawn } from "node:child_process";
import readline from "node:readline";
import type { AgentEvent } from "@pve-agent-console/shared-types";
import type { AgentAdapter, AgentRunInput } from "./types.js";

/**
 * Claude Code CLIをheadless(-p/--print)モードでサブプロセス起動するアダプター。
 *
 * 使用フラグは `claude --help` で実在を確認済み。stream-jsonの実スキーマは
 * `claude -p "1+1は?" --output-format stream-json --verbose` を実行して
 * 実際の出力(type: "system" | "rate_limit_event" | "assistant" | "user" | "result")を
 * 確認した上で実装している(docs/architecture.md 参照)。
 *
 * 認証はこのホストで事前に `claude login` 済みのサブスクリプションセッションに委ねる。
 * このアダプター自身はAPIキーを扱わない。
 */
export class ClaudeCodeAdapter implements AgentAdapter {
  readonly id = "claude-code" as const;

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn("claude", ["--version"], { stdio: "ignore" });
      child.on("error", () => resolve(false));
      child.on("exit", (code) => resolve(code === 0));
    });
  }

  async *run(input: AgentRunInput): AsyncIterable<AgentEvent> {
    const args = [
      "-p",
      input.prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--mcp-config",
      input.mcpConfigPath,
      "--strict-mcp-config",
    ];
    if (input.resumeSessionId) {
      args.push("--resume", input.resumeSessionId);
    }

    const child = spawn("claude", args, { stdio: ["ignore", "pipe", "pipe"] });
    const rl = readline.createInterface({ input: child.stdout });

    let stderrOutput = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderrOutput += chunk.toString("utf-8");
    });

    let sawResult = false;
    for await (const rawLine of rl) {
      if (!rawLine.trim()) continue;
      let json: unknown;
      try {
        json = JSON.parse(rawLine);
      } catch {
        continue;
      }
      for (const event of eventsFromLine(json)) {
        if (event.type === "done") sawResult = true;
        yield event;
      }
    }

    const exitCode = await new Promise<number>((resolve) => {
      child.on("exit", (code) => resolve(code ?? 1));
      child.on("error", () => resolve(1));
    });

    if (!sawResult) {
      yield {
        type: "error",
        message:
          exitCode === 0
            ? "claude CLI が result イベントを出力せずに終了しました"
            : `claude CLI が終了コード ${exitCode} で終了しました: ${stderrOutput.trim()}`,
      };
    }
  }
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  is_error?: boolean;
}

function* eventsFromLine(json: unknown): Generator<AgentEvent> {
  if (typeof json !== "object" || json === null || !("type" in json)) return;
  const line = json as { type: string; [key: string]: unknown };

  if (line.type === "assistant" || line.type === "user") {
    const message = line.message as { content?: unknown } | undefined;
    const content = Array.isArray(message?.content) ? (message.content as ContentBlock[]) : [];
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string") {
        yield { type: "text", text: block.text };
      } else if (block.type === "tool_use" && typeof block.name === "string") {
        yield { type: "tool_call", name: block.name, args: block.input };
      } else if (block.type === "tool_result") {
        yield {
          type: "tool_result",
          name: null,
          result: block.content,
          isError: block.is_error === true,
        };
      }
    }
    return;
  }

  if (line.type === "result") {
    yield {
      type: "done",
      sessionId: typeof line.session_id === "string" ? line.session_id : "",
      isError: line.is_error === true,
      summary: typeof line.result === "string" ? line.result : null,
    };
  }
}
