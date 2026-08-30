import { z } from "zod";
import { GATED_RISK_TIERS } from "./risk-tier.js";

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "timeout"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

// mcp-proxmoxのwrite/destructiveツール呼び出しをfast-returnで保留するレコード。
// docs/architecture.md 2.3節「承認フロー」を参照。
export const approvalSchema = z.object({
  id: z.string(),
  taskId: z.string().nullable(),
  toolName: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  riskTier: z.enum(GATED_RISK_TIERS),
  status: z.enum(APPROVAL_STATUSES),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  decidedBy: z.string().nullable(),
  // approved かつ executedAt が未設定のときのみ実際にPVE APIを実行する(冪等性の担保)
  executedAt: z.string().nullable(),
  result: z.unknown().nullable(),
});
export type Approval = z.infer<typeof approvalSchema>;

export const approvalCreateInputSchema = z.object({
  taskId: z.string().nullable(),
  toolName: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  riskTier: z.enum(GATED_RISK_TIERS),
});
export type ApprovalCreateInput = z.infer<typeof approvalCreateInputSchema>;

export const approvalDecisionInputSchema = z.object({
  id: z.string(),
  decision: z.enum(["approved", "rejected"]),
  decidedBy: z.string(),
});
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionInputSchema>;
