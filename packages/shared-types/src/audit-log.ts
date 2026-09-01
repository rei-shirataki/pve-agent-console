import { z } from "zod";
import { GATED_RISK_TIERS } from "./risk-tier.js";

// opencodeのpermission機構(ask)が発行した承認要求・決定の履歴レコード。
// 実行ブロックの実体はopencode server側にあり、これは受動的な監査ログでしかない。
// docs/adr/0001-adopt-opencode.md 参照。
export const auditLogEntrySchema = z.object({
  id: z.string(), // opencodeのpermission request id("per_..."形式)
  sessionId: z.string(),
  taskId: z.string().nullable(),
  toolName: z.string(),
  arguments: z.record(z.string(), z.unknown()).nullable(),
  riskTier: z.enum(GATED_RISK_TIERS).nullable(),
  decision: z.enum(["approved", "rejected"]),
  decidedBy: z.string().nullable(),
  askedAt: z.string(),
  decidedAt: z.string(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;
