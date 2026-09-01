import type { TaskType, TaskStatus, TaskPriority } from "@pve-agent-console/shared-types";

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  incident: "障害調査",
  change: "構成変更",
  maintenance: "定期メンテナンス",
  other: "その他",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: "未着手",
  in_progress: "対応中",
  blocked: "ブロック中",
  done: "完了",
  cancelled: "キャンセル",
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "緊急",
};
