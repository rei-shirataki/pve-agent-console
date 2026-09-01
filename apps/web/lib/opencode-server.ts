import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { writeOpencodeConfig, pveOptionsFromEnv } from "./opencode-config";

function resolveOpencodeBinary(): string {
  // opencode-aiはbin実行ファイルのみを提供するパッケージ(main/exportsを持たない)。
  // package.jsonのbinフィールド自体がプラットフォームごとの正しい相対パスを指すため、
  // それを都度読み取って解決する(docs/migration-plan.md Phase 0で実機確認済み)。
  // NOTE: 当初 import.meta.resolve() で解決していたが、Turbopackのサーバーバンドルで
  // 壊れる("Q.resolve is not a function")ことが実機で判明したため、process.cwd()
  // (next start/next devの実行ディレクトリ = apps/web)からのnode_modules探索に切り替えた。
  const pkgPath = path.resolve(process.cwd(), "node_modules/opencode-ai/package.json");
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`opencode-ai package.json が見つかりません: ${pkgPath}`);
  }
  const pkgDir = path.dirname(pkgPath);
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { bin?: Record<string, string> };
  const relBin = pkg.bin?.opencode;
  if (!relBin) {
    throw new Error("opencode-ai package.json に bin.opencode が見つかりません");
  }
  return path.resolve(pkgDir, relBin);
}

async function waitUntilReady(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/doc`);
      if (res.ok) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(
    `opencode serve が ${timeoutMs}ms 以内に起動しませんでした: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

export interface OpencodeServerHandle {
  baseUrl: string;
  process: ChildProcess;
}

let handlePromise: Promise<OpencodeServerHandle> | undefined;

/**
 * `opencode serve`を子プロセスとして起動する(apps/webのプロセスと運命を共にするシングルトン)。
 * cwdに生成したopencode.jsonを置くことで、MCPサーバー・パーミッション・agent設定を読み込ませる。
 */
export function startOpencodeServer(): Promise<OpencodeServerHandle> {
  handlePromise ??= (async () => {
    const binary = resolveOpencodeBinary();
    const port = Number(process.env.OPENCODE_PORT ?? 4097);
    const hostname = "127.0.0.1";
    const baseUrl = `http://${hostname}:${port}`;
    const cwd = writeOpencodeConfig({ pve: pveOptionsFromEnv() });

    const child = spawn(binary, ["serve", "--port", String(port), "--hostname", hostname], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      console.log(`[opencode] ${chunk.toString("utf-8").trimEnd()}`);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      console.error(`[opencode] ${chunk.toString("utf-8").trimEnd()}`);
    });
    child.on("exit", (code) => {
      console.error(`[opencode] serve process exited with code ${code}`);
      handlePromise = undefined;
    });

    await waitUntilReady(baseUrl, 30_000);
    return { baseUrl, process: child };
  })();
  return handlePromise;
}
