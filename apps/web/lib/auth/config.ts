/**
 * 認証設定の解決。Authentik(OIDC)が設定されていればそれのみを使い、
 * 未設定なら共有パスワードにフォールバックする(AskUserQuestionでの決定事項)。
 * どちらも未設定なら認証自体を無効化する(ローカル動作確認の利便性を優先)。
 */

export interface AuthentikConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function authentikConfig(): AuthentikConfig | null {
  const issuer = process.env.AUTHENTIK_ISSUER;
  const clientId = process.env.AUTHENTIK_CLIENT_ID;
  const clientSecret = process.env.AUTHENTIK_CLIENT_SECRET;
  const redirectUri = process.env.AUTHENTIK_REDIRECT_URI;
  if (!issuer || !clientId || !clientSecret || !redirectUri) return null;
  return { issuer, clientId, clientSecret, redirectUri };
}

export function authPassword(): string | undefined {
  return process.env.AUTH_PASSWORD;
}

export function isAuthEnabled(): boolean {
  return authentikConfig() !== null || !!authPassword();
}

export function authUserLabel(): string {
  return process.env.AUTH_USER_LABEL || "user";
}

/**
 * セッションCookie署名鍵。認証が有効なのに未設定なのは設定ミスなので、
 * fail-openにせず例外を投げて起動を止める(CLAUDE.md「fail-closed」原則)。
 */
export function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET is not set. It is required whenever AUTH_PASSWORD or AUTHENTIK_* is configured.",
    );
  }
  return secret;
}

export function cookieSecure(): boolean {
  return process.env.AUTH_COOKIE_SECURE === "true";
}
