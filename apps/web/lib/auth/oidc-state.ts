export const OIDC_STATE_COOKIE = "pve_oidc";
export const OIDC_STATE_TTL_SECONDS = 10 * 60;

export interface OidcStatePayload {
  /** PKCE code_verifier */
  v: string;
  /** CSRF対策のstate */
  s: string;
  /** ログイン完了後に戻る元のパス */
  n: string;
  /** 失効時刻(unixエポック秒) */
  exp: number;
}
