import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { approvals, type Db } from "@pve-agent-console/db";
import type { GatedRiskTier } from "@pve-agent-console/shared-types";

export interface PendingApprovalResult {
  status: "pending_approval";
  approvalId: string;
}

export interface ApprovalCheckResult {
  status: "pending" | "rejected" | "approved";
  approvalId: string;
  result?: unknown;
  reason?: string;
}

export type ToolExecutor = (args: Record<string, unknown>) => Promise<unknown>;

type StoredExecutionResult = { ok: true; value: unknown } | { ok: false; error: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * write/destructiveツール呼び出しの承認待ち・冪等実行を扱う。
 * docs/architecture.md 2.3節「承認フロー(fail-safeなfast-return方式)」の実装。
 */
export class ApprovalGate {
  constructor(private readonly db: Db) {}

  requestApproval(input: {
    taskId: string | null;
    toolName: string;
    args: unknown;
    riskTier: GatedRiskTier;
  }): PendingApprovalResult {
    const id = randomUUID();
    this.db
      .insert(approvals)
      .values({
        id,
        taskId: input.taskId,
        toolName: input.toolName,
        argumentsJson: JSON.stringify(input.args),
        riskTier: input.riskTier,
        status: "pending",
        createdAt: new Date().toISOString(),
      })
      .run();
    return { status: "pending_approval", approvalId: id };
  }

  /**
   * approval_check ツールから呼ばれる。短時間(既定20秒)だけポーリングし、
   * approvedを確認できたときだけ executors から対応する実行関数を呼び出す。
   *
   * 複数プロセス(=複数のmcp-proxmox stdioサブプロセス)から同時にapproval_checkが
   * 呼ばれても、`executed_at IS NULL` を条件にした compare-and-swap 更新で
   * 実行を1回だけに保証する(取れなかった側は結果が書き込まれるまで待つ)。
   */
  async check(
    approvalId: string,
    executors: ReadonlyMap<string, ToolExecutor>,
    options: { pollIntervalMs?: number; maxWaitMs?: number } = {},
  ): Promise<ApprovalCheckResult> {
    const pollIntervalMs = options.pollIntervalMs ?? 1000;
    const maxWaitMs = options.maxWaitMs ?? 20_000;
    const deadline = Date.now() + maxWaitMs;

    for (;;) {
      const row = this.db.select().from(approvals).where(eq(approvals.id, approvalId)).get();
      if (!row) {
        return { status: "rejected", approvalId, reason: "approval not found" };
      }

      if (row.status === "rejected" || row.status === "timeout") {
        return { status: "rejected", approvalId, reason: row.status };
      }

      if (row.status === "approved") {
        if (row.executedAt) {
          if (row.resultJson) {
            const stored = JSON.parse(row.resultJson) as StoredExecutionResult;
            return stored.ok
              ? { status: "approved", approvalId, result: stored.value }
              : { status: "rejected", approvalId, reason: stored.error };
          }
          // 他プロセスが実行をclaim済みだが結果未確定。書き込まれるまで待つ。
          await sleep(pollIntervalMs);
          continue;
        }

        // executed_at IS NULL を条件にした compare-and-swap。
        // 「claim成功」＝このプロセスだけがexecuteを呼ぶ権利を得た、という意味にする。
        // 以降は成功・失敗いずれの結果も必ずresultJsonに書き込み、claimしたまま
        // 結果を記録し損ねて他プロセスを待たせ続ける状態を作らない。
        const claim = this.db
          .update(approvals)
          .set({ executedAt: new Date().toISOString() })
          .where(and(eq(approvals.id, approvalId), isNull(approvals.executedAt)))
          .run();

        if (claim.changes === 0) {
          // 他プロセスが先にclaimした。自分は実行せず結果を待つ。
          await sleep(pollIntervalMs);
          continue;
        }

        const execute = executors.get(row.toolName);
        if (!execute) {
          const reason = `unknown tool: ${row.toolName}`;
          this.saveResult(approvalId, { ok: false, error: reason });
          return { status: "rejected", approvalId, reason };
        }

        const args = JSON.parse(row.argumentsJson) as Record<string, unknown>;
        try {
          const result = await execute(args);
          this.saveResult(approvalId, { ok: true, value: result });
          return { status: "approved", approvalId, result };
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          this.saveResult(approvalId, { ok: false, error: reason });
          return { status: "rejected", approvalId, reason };
        }
      }

      // pending: CLI側のツール呼び出しタイムアウトに収まる範囲で短時間だけ待つ
      if (Date.now() >= deadline) {
        return { status: "pending", approvalId };
      }
      await sleep(pollIntervalMs);
    }
  }

  private saveResult(approvalId: string, result: StoredExecutionResult): void {
    this.db
      .update(approvals)
      .set({ resultJson: JSON.stringify(result) })
      .where(eq(approvals.id, approvalId))
      .run();
  }
}
