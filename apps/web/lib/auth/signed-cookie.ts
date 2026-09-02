import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * `${JSONペイロードのbase64url}.${HMAC-SHA256署名のbase64url}` 形式の
 * 自己完結型署名Cookie値。セッションCookie・OIDC state用一時Cookieの両方で使う。
 */
export function signPayload<T>(payload: T, secret: string): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

export function verifyPayload<T>(value: string | undefined, secret: string): T | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot === -1) return null;
  const payloadB64 = value.slice(0, dot);
  const sig = value.slice(dot + 1);

  const expectedSig = createHmac("sha256", secret).update(payloadB64).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}
