/**
 * Next.jsのインストルメンテーションフック。サーバープロセス起動時に一度だけ呼ばれる。
 * opencode serveの起動、audit_logへのバックグラウンド記録の開始に加え、
 * 認証設定の妥当性チェック(未設定時の警告、設定不備時のfail-fast)をここで行う。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { isAuthEnabled, authSecret } = await import("./lib/auth/config");
  if (!isAuthEnabled()) {
    console.warn(
      "[auth] AUTH_PASSWORD / AUTHENTIK_* is not set — apps/web is running WITHOUT authentication. " +
        "Set AUTH_PASSWORD (or AUTHENTIK_ISSUER/AUTHENTIK_CLIENT_ID/AUTHENTIK_CLIENT_SECRET/AUTHENTIK_REDIRECT_URI) " +
        "to protect this app before exposing it beyond a trusted LAN.",
    );
  } else {
    authSecret(); // 未設定ならここで例外を投げて起動を止める(fail-closed)
  }

  const { getOpencodeClient } = await import("./lib/opencode-client");
  const { getDb } = await import("./lib/db");
  const { AuditLogRepository, TaskRepository } = await import("@pve-agent-console/db");
  const { startAuditLogConsumer } = await import("./lib/audit-log-consumer");

  const { client } = await getOpencodeClient();
  const auditRepo = new AuditLogRepository(getDb());
  const taskRepo = new TaskRepository(getDb());

  startAuditLogConsumer(client, auditRepo, taskRepo);
}
