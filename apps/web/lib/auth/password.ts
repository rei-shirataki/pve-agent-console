import { createHash, timingSafeEqual } from "node:crypto";

/**
 * 共有パスワードの定数時間比較。長さの異なる文字列をtimingSafeEqualに渡すと例外になるため、
 * 先に両方を固定長(SHA-256)へハッシュしてから比較する。
 */
export function passwordMatches(candidate: string, expected: string): boolean {
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
