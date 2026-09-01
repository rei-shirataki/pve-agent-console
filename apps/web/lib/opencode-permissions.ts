/**
 * `@opencode-ai/sdk`(1.18.25時点)はpermission系のオペレーション(`permission.list` /
 * `permission.reply`)をクライアントの便利メソッドとしてまだラップしていない
 * (SDKオブジェクトのプロトタイプに`permission`名前空間が存在しないことを実機で確認済み。
 * docs/migration-plan.md Phase 0参照)。OpenAPI仕様(`GET {baseUrl}/doc`)には
 * `operationId: "permission.list"` / `"permission.reply"` として実在するため、
 * このモジュールでは生のHTTPエンドポイントを直接叩く。
 */

export interface PermissionRequest {
  id: string;
  sessionID: string;
  permission: string; // ツール名
  patterns: string[];
  metadata: Record<string, unknown>;
  always: string[];
  tool: { messageID: string; callID: string };
}

export type PermissionReplyAction = "once" | "always" | "reject";

export async function listPermissions(baseUrl: string): Promise<PermissionRequest[]> {
  const res = await fetch(`${baseUrl}/permission`);
  if (!res.ok) {
    throw new Error(`GET /permission failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as PermissionRequest[];
}

export async function replyToPermission(
  baseUrl: string,
  requestId: string,
  action: PermissionReplyAction,
  message?: string,
): Promise<void> {
  const res = await fetch(`${baseUrl}/permission/${encodeURIComponent(requestId)}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reply: action, ...(message ? { message } : {}) }),
  });
  if (!res.ok) {
    throw new Error(`POST /permission/${requestId}/reply failed: ${res.status} ${await res.text()}`);
  }
}
