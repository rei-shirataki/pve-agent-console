export const RISK_TIERS = ["read", "write", "destructive"] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

// write/destructive はPVE操作の実行前にユーザー承認を必須にするtier。
// read はデフォルト許可でapprovalsテーブルを経由しない。
export const GATED_RISK_TIERS = ["write", "destructive"] as const;
export type GatedRiskTier = (typeof GATED_RISK_TIERS)[number];

export function requiresApproval(tier: RiskTier): tier is GatedRiskTier {
  return tier === "write" || tier === "destructive";
}
