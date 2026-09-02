import { signPayload, verifyPayload } from "./signed-cookie";

export const SESSION_COOKIE = "pve_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface SessionPayload {
  /** ログイン中のユーザー識別子(Authentikのpreferred_username、または共有パスワード時はAUTH_USER_LABEL) */
  u: string;
  /** 失効時刻(unixエポック秒) */
  exp: number;
}

export function createSessionCookieValue(
  user: string,
  secret: string,
  ttlSeconds = SESSION_TTL_SECONDS,
): string {
  const payload: SessionPayload = { u: user, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  return signPayload(payload, secret);
}

/** 署名・有効期限を検証し、正当なら中身を返す。不正・期限切れならnull。 */
export function verifySessionCookieValue(
  value: string | undefined,
  secret: string,
): SessionPayload | null {
  const payload = verifyPayload<SessionPayload>(value, secret);
  if (!payload) return null;
  if (typeof payload.u !== "string" || typeof payload.exp !== "number") return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
